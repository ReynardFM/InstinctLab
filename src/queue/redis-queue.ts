// Stage 4: a job queue in Redis, so experiment runs can be done by worker processes (Docker containers)
// instead of threads inside one program. Rey's design 2026-10-20: Redis, retry when a worker dies,
// at most 3 attempts per job.
//
// How a job travels (all keys start with "lab:"):
//   pending (list)  --worker claims-->  active (list)  --worker finishes-->  results:<run> (hash)
// A worker that holds a job keeps a lease (lab:lease:<id>, expires after LEASE_MS) alive with a
// heartbeat. If the lease runs out, the worker is presumed dead: the coordinator (the program that
// sent the jobs) puts the job back in pending, or in dead:<run> after MAX_ATTEMPTS failed attempts.
// Failures are counted when they happen (not when a job is claimed), so a worker that dies right
// after claiming still uses up an attempt. A worker that is asked to stop (docker stop) hands its job
// back instead: that is not a failure.
// Runs are deterministic, so a job that runs twice gives the same numbers: retrying is always safe,
// and the second result is checked against the first (a mismatch would mean determinism broke).
import { createClient } from "@redis/client";
import type { Job, JobResult } from "../cli/job.ts";

export const KEYS = {
  pending: "lab:pending",
  active: "lab:active",
  job: (id: string) => `lab:job:${id}`, // hash: payload (the Job as JSON), failures, handbacks, error
  lease: (id: string) => `lab:lease:${id}`,
  results: (run: string) => `lab:results:${run}`, // hash: job index -> JobResult as JSON
  dead: (run: string) => `lab:dead:${run}`, // jobs that failed MAX_ATTEMPTS times
  repeat: (run: string) => `lab:repeat:${run}`, // jobs that finished twice (a slow worker came back after a retry)
  mismatch: (run: string) => `lab:mismatch:${run}`, // ... and whose second result differed from the first
  worker: (name: string) => `lab:worker:${name}`, // a live worker: what it is doing; expires if it dies
};

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
// Timing (environment variables, so tests can make them short). The lease must outlast a heartbeat
// gap by a wide margin: a busy laptop can delay a heartbeat by seconds.
export const LEASE_MS = num("LAB_LEASE_MS", 30000);
export const HEARTBEAT_MS = num("LAB_HEARTBEAT_MS", 5000);
export const MAX_ATTEMPTS = num("LAB_MAX_ATTEMPTS", 3);

const newClient = (url: string) => createClient({ url });
export type Redis = ReturnType<typeof newClient>;

export async function connect(url: string): Promise<Redis> {
  const client = newClient(url);
  client.on("error", () => {}); // reconnects on its own; a failed command still throws where it is awaited
  await client.connect();
  return client;
}

export const jobId = (run: string, index: number) => `${run}:${index}`;
export const runOf = (id: string) => id.slice(0, id.lastIndexOf(":"));
export const indexOf = (id: string) => Number(id.slice(id.lastIndexOf(":") + 1));

// A failed attempt (the worker died, or the job threw): try again, or give up after MAX_ATTEMPTS.
// Used by the coordinator (lease ran out) and by a worker (the job threw an error).
export async function retryOrBury(r: Redis, id: string, error: string): Promise<"retry" | "dead"> {
  const failures = await r.hIncrBy(KEYS.job(id), "failures", 1);
  const dead = failures >= MAX_ATTEMPTS;
  const tx = r.multi().lRem(KEYS.active, 0, id).del(KEYS.lease(id)).hSet(KEYS.job(id), "error", error);
  if (dead) tx.rPush(KEYS.dead(runOf(id)), id);
  else tx.rPush(KEYS.pending, id); // the right end is where workers take from: it runs next
  await tx.exec();
  return dead ? "dead" : "retry";
}

// A worker that was asked to stop puts its job back untouched: it runs next, and no attempt is used.
export async function handBack(r: Redis, id: string): Promise<void> {
  await r.multi().lRem(KEYS.active, 0, id).del(KEYS.lease(id)).hIncrBy(KEYS.job(id), "handbacks", 1).rPush(KEYS.pending, id).exec();
}

export interface QueueReport {
  retries: number; // failed attempts that were tried again: a worker died or went quiet, or the run threw
  quiet: number; // of those, workers that stopped responding (lease ran out)
  handedBack: number; // jobs a stopping worker put back (not failures)
  repeats: number; // runs that finished twice (a slow worker came back after its job was retried); results identical
}

// The coordinator: sends the jobs, collects results, and retries jobs whose worker went quiet.
// Same shape as runJobs() in cli/pool.ts: results in job order, onResult as each one finishes.
export async function runJobsOnQueue(
  jobs: Job[], url: string,
  onProgress?: (done: number) => void, onResult?: (index: number, result: JobResult) => void,
  report?: QueueReport,
): Promise<JobResult[]> {
  const r = await connect(url);
  const run = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const ids = jobs.map((_, i) => jobId(run, i));
  const results: JobResult[] = new Array(jobs.length);
  const quietSince = new Map<string, number>(); // active jobs without a lease, and since when
  const rep = report ?? { retries: 0, quiet: 0, handedBack: 0, repeats: 0 };
  try {
    const tx = r.multi();
    for (let i = 0; i < jobs.length; i++) tx.hSet(KEYS.job(ids[i]), { payload: JSON.stringify(jobs[i]), failures: 0, handbacks: 0 });
    if (ids.length) tx.lPush(KEYS.pending, ids); // first job ends up at the right end: taken first
    await tx.exec();

    let done = 0;
    while (done < jobs.length) {
      await new Promise((ok) => setTimeout(ok, 200));
      // new results
      if ((await r.hLen(KEYS.results(run))) > done) {
        for (const [k, v] of Object.entries(await r.hGetAll(KEYS.results(run)))) {
          const i = Number(k);
          if (results[i] !== undefined) continue;
          results[i] = JSON.parse(v) as JobResult;
          done++;
          onResult?.(i, results[i]);
          onProgress?.(done);
        }
      }
      // jobs that failed for good
      const dead = await r.lRange(KEYS.dead(run), 0, -1);
      if (dead.length) {
        const errors = await Promise.all(dead.map((id) => r.hGet(KEYS.job(id), "error")));
        throw new Error(
          `${dead.length} run(s) failed ${MAX_ATTEMPTS} times: ` +
            dead.map((id, k) => `#${indexOf(id) + 1} (${errors[k] ?? "unknown"})`).join(", "),
        );
      }
      // workers that went quiet: no lease for longer than a lease lasts
      const now = Date.now();
      for (const id of await r.lRange(KEYS.active, 0, -1)) {
        if (runOf(id) !== run) continue; // another grid's job
        if (results[indexOf(id)] !== undefined) {
          await r.lRem(KEYS.active, 0, id); // finished, but the worker died before tidying up
          continue;
        }
        if (await r.exists(KEYS.lease(id))) {
          quietSince.delete(id);
          continue;
        }
        const since = quietSince.get(id) ?? now;
        quietSince.set(id, since);
        if (now - since >= LEASE_MS) {
          quietSince.delete(id);
          await retryOrBury(r, id, "worker stopped responding");
          rep.quiet++;
        }
      }
    }
    const mismatches = await r.lLen(KEYS.mismatch(run));
    if (mismatches > 0) throw new Error(`${mismatches} run(s) gave different numbers when repeated: determinism broke`);
    const counts = await Promise.all(ids.map((id) => r.hmGet(KEYS.job(id), ["failures", "handbacks"])));
    rep.retries = counts.reduce((s, [f]) => s + Number(f ?? 0), 0);
    rep.handedBack = counts.reduce((s, [, h]) => s + Number(h ?? 0), 0);
    rep.repeats = await r.lLen(KEYS.repeat(run));
    return results;
  } finally {
    // tidy up this grid's keys (jobs still queued after an error are dropped)
    const tx = r.multi();
    for (const id of ids) tx.del([KEYS.job(id), KEYS.lease(id)]).lRem(KEYS.pending, 0, id).lRem(KEYS.active, 0, id);
    tx.del([KEYS.results(run), KEYS.dead(run), KEYS.repeat(run), KEYS.mismatch(run)]);
    await tx.exec();
    await r.quit();
  }
}

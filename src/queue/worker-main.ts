// A queue worker: one process (one Docker container) that takes jobs from Redis one at a time.
//   REDIS_URL=redis://127.0.0.1:6379 node src/queue/worker-main.ts
// The run itself happens in a thread (cli/worker.ts, the same one the thread pool uses): a run keeps
// its thread busy for seconds to minutes, and the heartbeat that keeps the lease alive needs this
// thread free in the meantime.
import { Worker } from "node:worker_threads";
import { hostname } from "node:os";
import type { Job, JobResult } from "../cli/job.ts";
import { connect, handBack, HEARTBEAT_MS, indexOf, KEYS, LEASE_MS, retryOrBury, runOf } from "./redis-queue.ts";

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
// "<container id>:<pid>" in Docker (the hostname is the container id), so `docker kill <id>` hits this worker
const name = process.env.WORKER_NAME ?? `${hostname()}:${process.pid}`;
const log = (msg: string) => console.log(`[${name}] ${msg}`);

function startThread(): Worker {
  return new Worker(new URL("../cli/worker.ts", import.meta.url));
}

function runInThread(thread: Worker, job: Job): Promise<JobResult> {
  return new Promise((ok, fail) => {
    const done = () => {
      thread.off("message", onMessage);
      thread.off("error", onError);
    };
    const onMessage = (m: { result: JobResult }) => (done(), ok(m.result));
    const onError = (e: Error) => (done(), fail(e));
    thread.on("message", onMessage);
    thread.on("error", onError);
    thread.postMessage({ index: 0, job });
  });
}

async function main(): Promise<void> {
  const r = await connect(url); // jobs and results
  const hb = await connect(url); // heartbeats: never stuck behind a slow command on the other connection
  let thread = startThread();
  // docker stop sends SIGTERM: a job in progress is handed back (not a failure), then the worker exits
  let stopping = false;
  let onStop = () => {};
  const stop = () => {
    stopping = true;
    onStop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const alive = (doing: string) => hb.set(KEYS.worker(name), doing, { PX: LEASE_MS }).catch(() => {});
  log(`waiting for jobs at ${url}`);
  while (!stopping) {
    await alive("idle");
    const id = await r.blMove(KEYS.pending, KEYS.active, "RIGHT", "LEFT", 2); // wait up to 2 s
    if (!id) continue;
    await hb.set(KEYS.lease(id), name, { PX: LEASE_MS });
    const beat = setInterval(() => {
      void hb.set(KEYS.lease(id), name, { PX: LEASE_MS }).catch(() => {});
      void alive(`run ${id}`);
    }, HEARTBEAT_MS);
    try {
      const [payload, failures] = await r.hmGet(KEYS.job(id), ["payload", "failures"]);
      if (payload === null) {
        await r.multi().lRem(KEYS.active, 0, id).del(KEYS.lease(id)).exec(); // its grid was cancelled and tidied up
        continue;
      }
      const attempt = Number(failures ?? 0) + 1;
      await alive(`run ${id}`);
      log(`run #${indexOf(id) + 1}, attempt ${attempt}`);
      const stopped = new Promise<"stop">((ok) => (onStop = () => ok("stop")));
      if (stopping) onStop();
      let result: JobResult | "stop";
      try {
        result = await Promise.race([runInThread(thread, JSON.parse(payload) as Job), stopped]);
        clearInterval(beat); // stop renewing before the lease is deleted below
      } catch (e) {
        clearInterval(beat);
        void thread.terminate();
        thread = startThread();
        const what = await retryOrBury(r, id, `${(e as Error).message}`);
        log(`run #${indexOf(id) + 1} failed (${(e as Error).message}): ${what}`);
        continue;
      } finally {
        onStop = () => {};
      }
      if (result === "stop") {
        await handBack(r, id);
        log(`run #${indexOf(id) + 1} handed back (stopping)`);
        break;
      }
      const json = JSON.stringify(result);
      const first = await r.hSetNX(KEYS.results(runOf(id)), String(indexOf(id)), json);
      if (!first) {
        // this job was retried while we were still on it: both results must be the same
        const earlier = await r.hGet(KEYS.results(runOf(id)), String(indexOf(id)));
        await r.rPush(KEYS.repeat(runOf(id)), id);
        if (earlier !== json) await r.rPush(KEYS.mismatch(runOf(id)), id);
        log(`run #${indexOf(id) + 1} finished twice; results ${earlier === json ? "identical" : "DIFFERENT"}`);
      }
      await r.multi().lRem(KEYS.active, 0, id).del(KEYS.lease(id)).exec();
    } finally {
      clearInterval(beat);
    }
  }
  log("stopping");
  await hb.del(KEYS.worker(name)).catch(() => {});
  await thread.terminate();
  await r.quit();
  await hb.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Stage 4 queue (src/queue): needs a redis-server program on this machine. When there is none (e.g. on
// Windows without Redis installed) these tests are skipped; the Docker setup (README) runs Redis instead.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = 6399;
const URL_ = `redis://127.0.0.1:${PORT}`;
// short timings, so a dead worker is noticed in about a second
const ENV = { ...process.env, REDIS_URL: URL_, LAB_LEASE_MS: "1200", LAB_HEARTBEAT_MS: "150" };
Object.assign(process.env, ENV); // read by redis-queue.ts when it is imported below

const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;
const skip = hasRedis ? false : "redis-server is not installed here (Docker runs it instead)";
let server: ChildProcess | undefined;
const workers: ChildProcess[] = [];

function startWorker(onLine?: (line: string) => void): ChildProcess {
  const p = spawn(process.execPath, [fileURLToPath(new URL("../src/queue/worker-main.ts", import.meta.url))], { env: ENV });
  p.stdout!.on("data", (d) => onLine?.(String(d)));
  workers.push(p);
  return p;
}

before(async () => {
  if (!hasRedis) return;
  server = spawn("redis-server", ["--port", String(PORT), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  await sleep(400);
});

after(() => {
  for (const w of workers) w.kill("SIGKILL");
  server?.kill();
});

const { DEFAULT_RULES } = await import("../src/engine/world.ts");
const { runJobs } = await import("../src/cli/pool.ts");
const jobs = [1, 2, 3, 4].map((seed) => ({ seed, rules: DEFAULT_RULES, gens: 2 }));

test("queue: workers give exactly the same results as threads, in job order", { skip }, async () => {
  const { runJobsOnQueue } = await import("../src/queue/redis-queue.ts");
  startWorker();
  startWorker();
  const seen: number[] = [];
  const report = { retries: 0, quiet: 0, repeats: 0 };
  const viaQueue = await runJobsOnQueue(jobs, URL_, undefined, (i) => seen.push(i), report);
  assert.deepEqual(viaQueue, await runJobs(jobs, 2));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3], "every result reported once as it arrived");
  assert.deepEqual(report, { retries: 0, quiet: 0, repeats: 0 });
  for (const w of workers.splice(0)) w.kill("SIGKILL");
});

test("queue: a worker killed in the middle of a run; another one redoes it, same numbers", { skip }, async () => {
  const { runJobsOnQueue } = await import("../src/queue/redis-queue.ts");
  let killed = false;
  const victim = startWorker((line) => {
    if (!killed && line.includes("attempt 1")) {
      killed = true;
      setTimeout(() => victim.kill("SIGKILL"), 200); // mid-run: a run here takes about a second
    }
  });
  startWorker();
  const report = { retries: 0, quiet: 0, repeats: 0 };
  const viaQueue = await runJobsOnQueue(jobs, URL_, undefined, undefined, report);
  assert.ok(killed, "a worker was killed");
  assert.deepEqual(viaQueue, await runJobs(jobs, 2), "results identical to threads");
  assert.ok(report.quiet >= 1 && report.retries >= 1, `the dead worker's run was retried: ${JSON.stringify(report)}`);
  for (const w of workers.splice(0)) w.kill("SIGKILL");
});

test("queue: a run that fails every time is given up after 3 attempts, and reported", { skip }, async () => {
  const { runJobsOnQueue } = await import("../src/queue/redis-queue.ts");
  const lines: string[] = [];
  startWorker((l) => lines.push(l));
  const broken = [{ seed: 1, rules: undefined, gens: 1 }] as unknown as typeof jobs; // createWorld throws
  await assert.rejects(runJobsOnQueue(broken, URL_), /1 run\(s\) failed 3 times: #1/);
  const attempts = lines.join("").match(/attempt \d/g) ?? [];
  assert.deepEqual(attempts, ["attempt 1", "attempt 2", "attempt 3"], "tried exactly 3 times");
  for (const w of workers.splice(0)) w.kill("SIGKILL");
});

// Stage 4 check in one command (needs Docker Desktop running):  npm run queue-demo
// 1. starts Redis + 4 worker containers (docker compose)
// 2. sends a grid through the queue, and kills one worker container in the middle of a run
//    (it watches Redis to see who is busy, so no timing by hand)
// 3. restarts that worker and sends the grid again with no kill (a fair speed number)
// 4. runs the same grid on 4 threads
// 5. prints: identical or not, retries, who redid the killed run, time for each, then stops the containers
// Options: --gens=N (default 60), --seeds=1-14 (default), --keep (leave the containers running)
import { spawnSync } from "node:child_process";
import { deepStrictEqual } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_RULES } from "../src/engine/world.ts";
import { runJobs } from "../src/cli/pool.ts";
import { seedList } from "../src/cli/run.ts";
import { connect, KEYS, LEASE_MS, runJobsOnQueue } from "../src/queue/redis-queue.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const gens = Number(arg("gens") ?? 60);
const seeds = seedList(arg("seeds") ?? "1-14");
const keep = process.argv.includes("--keep");
const URL_ = "redis://127.0.0.1:6379";
const WORKERS = 4;

const docker = (args: string[], quiet = false) => {
  const r = spawnSync("docker", args, { encoding: "utf8", stdio: quiet ? "pipe" : "inherit" });
  if (r.status !== 0) throw new Error(`docker ${args.join(" ")} failed${r.stderr ? `: ${r.stderr}` : ""} (is Docker Desktop running?)`);
  return r.stdout ?? "";
};
const say = (s: string) => console.log(`\n== ${s}`);

say(`starting Redis + ${WORKERS} workers`);
docker(["compose", "up", "-d", "--build", "--scale", `worker=${WORKERS}`]);

// wait until Redis answers
let r;
for (let i = 0; ; i++) {
  try {
    r = await connect(URL_);
    break;
  } catch (e) {
    if (i > 30) throw e;
    await sleep(500);
  }
}

const jobs = seeds.map((seed) => ({ seed, rules: DEFAULT_RULES, gens }));
say(`grid: ${jobs.length} runs x ${gens} generations through the queue; one worker will be killed mid-run`);

// the killer: wait for a worker to be busy for a few seconds, then kill its container
let killed = "";
let gridDone = false; // a very short grid can finish before anyone is killed: then the killer gives up
const killer = (async () => {
  while (!gridDone) {
    const leases = await r.keys(`${KEYS.lease("")}*`);
    if (leases.length) {
      const owner = await r.get(leases[0]); // "<container id>:<pid>"
      await sleep(3000); // well inside a run (one run takes ~15 s or more)
      if (owner && (await r.get(leases[0])) === owner) {
        killed = owner.slice(0, owner.lastIndexOf(":"));
        docker(["kill", killed], true);
        console.log(`   killed worker ${killed} while it was running a job (lease ${leases[0].slice(KEYS.lease("").length)})`);
        console.log(`   its job comes back after ${LEASE_MS / 1000} s without a heartbeat`);
        return;
      }
    }
    await sleep(250);
  }
})();

const progress = (done: number) => process.stdout.write(`\r   ${done} of ${jobs.length} runs done`);
const report = { retries: 0, quiet: 0, handedBack: 0, repeats: 0 };
let t0 = performance.now();
const viaQueue = await runJobsOnQueue(jobs, URL_, progress, undefined, report);
const killSecs = (performance.now() - t0) / 1000;
gridDone = true;
await killer;
console.log();

say(`same grid through the queue again, no kill (speed)`);
if (killed) docker(["start", killed], true); // back to ${WORKERS} workers
const clean = { retries: 0, quiet: 0, handedBack: 0, repeats: 0 };
t0 = performance.now();
const viaQueue2 = await runJobsOnQueue(jobs, URL_, progress, undefined, clean);
const queueSecs = (performance.now() - t0) / 1000;
console.log();

say(`same grid on ${WORKERS} threads`);
t0 = performance.now();
const viaThreads = await runJobs(jobs, WORKERS, (done) => process.stdout.write(`\r   ${done} of ${jobs.length} runs done`));
const threadSecs = (performance.now() - t0) / 1000;
console.log();

let identical = true;
try {
  deepStrictEqual(viaQueue, viaThreads);
  deepStrictEqual(viaQueue2, viaThreads);
} catch {
  identical = false;
}
const redone = docker(["compose", "logs", "worker", "--no-color"], true)
  .split("\n")
  .filter((l) => /attempt [2-9]|finished twice|failed/.test(l));

const g = jobs.length * gens;
say("result");
console.log(`   identical to threads:   ${identical ? "YES (both queue passes)" : "NO  <-- determinism or queue bug"}`);
console.log(`   worker killed mid-run:  ${killed ? `yes (${killed})` : "no"}`);
console.log(`   retried runs:           ${report.retries} (${report.quiet} because a worker stopped responding)`);
console.log(`   redone by:              ${redone.length ? "" : "(nothing in the logs)"}`);
for (const l of redone) console.log(`     ${l.trim()}`);
const rate = (s: number) => `${s.toFixed(1)} s = ${(g / s).toFixed(1)} generations/s`;
console.log(`   queue with the kill:    ${rate(killSecs)} (includes the ${LEASE_MS / 1000} s wait for the dead worker)`);
console.log(`   queue, ${WORKERS} containers:  ${rate(queueSecs)}`);
console.log(`   threads, ${WORKERS} workers:   ${rate(threadSecs)}`);
console.log(`   queue / threads speed:  ${(threadSecs / queueSecs).toFixed(2)}x`);
const pass = identical && !!killed && report.quiet >= 1 && redone.length > 0;
console.log(`\n   ${pass ? "PASS: a worker died mid-run, its job was redone, and the numbers are identical" : "NOT A PASS: see above"}`);

await r.quit();
if (!keep) {
  say("stopping the containers");
  docker(["compose", "down"]);
}
process.exit(pass ? 0 : 1);

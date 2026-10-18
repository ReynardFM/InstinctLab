// Stage 3 headline number: generations per second as workers are added, same workload every time.
//
// npm run bench                          default: 2 runs per core, 5 generations each, 3 trials
// npm run bench -- --runs=56 --gens=10 --trials=1
//
// Each row is the median of the trials. Also reports what the CPU says it is, how long starting the
// workers takes (so it can be ruled in or out as the reason for poor scaling), and checks that every
// worker count produced exactly the same results.
import { availableParallelism, cpus } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_RULES } from "../engine/world.ts";
import type { Job, JobResult } from "./job.ts";
import { runJobs } from "./pool.ts";

// 1, 2, 4, 8 ... up to the number of cores, always ending with the core count itself.
export function workerCounts(cores: number): number[] {
  const counts: number[] = [];
  for (let n = 1; n < cores; n *= 2) counts.push(n);
  counts.push(cores);
  return counts;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// "13th Gen Intel(R) Core(TM) i7-13700H x 20" style summary of what the OS reports.
function cpuSummary(): string {
  const counts = new Map<string, number>();
  for (const c of cpus()) counts.set(c.model.trim(), (counts.get(c.model.trim()) ?? 0) + 1);
  return [...counts].map(([model, n]) => `${model} x ${n}`).join(", ");
}

async function main(): Promise<void> {
  const cores = availableParallelism();
  let runs = Math.max(8, cores * 2);
  let gens = 5;
  let trials = 3;
  for (const arg of process.argv.slice(2)) {
    const m = /^--(runs|gens|trials)=(\d+)$/.exec(arg);
    if (!m) throw new Error(`Can't read "${arg}". Use --runs=N, --gens=N or --trials=N`);
    if (m[1] === "runs") runs = Number(m[2]);
    else if (m[1] === "gens") gens = Number(m[2]);
    else trials = Math.max(1, Number(m[2]));
  }
  const jobs: Job[] = Array.from({ length: runs }, (_, i) => ({ seed: i + 1, rules: DEFAULT_RULES, gens }));
  const total = runs * gens;
  console.log(`CPU: ${cpuSummary()}`);
  console.log(`${cores} logical cores available to Node. Workload: ${runs} runs x ${gens} generations = ${total} generations, default rules, median of ${trials} trial(s).\n`);

  // startup cost: the same pool, but every job is empty (0 generations)
  const empty: Job[] = Array.from({ length: cores }, (_, i) => ({ seed: i + 1, rules: DEFAULT_RULES, gens: 0 }));
  const t0 = performance.now();
  await runJobs(empty, cores);
  const startupMs = performance.now() - t0;

  console.log("workers  seconds  gens/s  gens/hour  speedup  efficiency");
  let first: JobResult[] | null = null;
  let base = 0;
  let same = true;
  for (const n of workerCounts(cores)) {
    const times: number[] = [];
    for (let t = 0; t < trials; t++) {
      const start = performance.now();
      const results = await runJobs(jobs, n);
      times.push((performance.now() - start) / 1000);
      if (!first) first = results;
      else if (!isDeepStrictEqual(results, first)) same = false;
    }
    const secs = median(times);
    const rate = total / secs;
    if (!base) base = rate;
    console.log(
      [String(n).padStart(7), secs.toFixed(1).padStart(7), rate.toFixed(1).padStart(6),
        Math.round(rate * 3600).toString().padStart(9), `${(rate / base).toFixed(2)}x`.padStart(7),
        `${Math.round((rate / base / n) * 100)}%`.padStart(10)].join("  "),
    );
  }
  console.log(`\nspeedup = gens/s vs 1 worker. efficiency = speedup / workers (100% = perfect).`);
  console.log(`Starting ${cores} workers and handing them empty jobs took ${startupMs.toFixed(0)} ms.`);
  console.log(`Same results with every worker count: ${same ? "yes" : "NO - determinism is broken"}`);
}

if (import.meta.main ?? process.argv[1]?.endsWith("bench.ts")) await main();

// Stage 3 headline number: generations per second as workers are added, same workload every time.
//
// npm run bench                     default: 2 runs per core, 5 generations each, default rules
// npm run bench -- --runs=16 --gens=10
//
// Also checks that every worker count produced exactly the same results.
import { availableParallelism } from "node:os";
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

async function main(): Promise<void> {
  const cores = availableParallelism();
  let runs = Math.max(8, cores * 2);
  let gens = 5;
  for (const arg of process.argv.slice(2)) {
    const m = /^--(runs|gens)=(\d+)$/.exec(arg);
    if (!m) throw new Error(`Can't read "${arg}". Use --runs=N or --gens=N`);
    if (m[1] === "runs") runs = Number(m[2]);
    else gens = Number(m[2]);
  }
  const jobs: Job[] = Array.from({ length: runs }, (_, i) => ({ seed: i + 1, rules: DEFAULT_RULES, gens }));
  const total = runs * gens;
  console.log(`${cores} CPU cores. Workload: ${runs} runs x ${gens} generations = ${total} generations, default rules.\n`);
  console.log("workers  seconds  gens/s  gens/hour  speedup  efficiency");

  let first: JobResult[] | null = null;
  let base = 0;
  let same = true;
  for (const n of workerCounts(cores)) {
    const t0 = performance.now();
    const results = await runJobs(jobs, n);
    const secs = (performance.now() - t0) / 1000;
    const rate = total / secs;
    if (!first) {
      first = results;
      base = rate;
    } else if (!isDeepStrictEqual(results, first)) same = false;
    console.log(
      [String(n).padStart(7), secs.toFixed(1).padStart(7), rate.toFixed(1).padStart(6),
        Math.round(rate * 3600).toString().padStart(9), `${(rate / base).toFixed(2)}x`.padStart(7),
        `${Math.round((rate / base / n) * 100)}%`.padStart(10)].join("  "),
    );
  }
  console.log(`\nspeedup = gens/s vs 1 worker. efficiency = speedup / workers (100% = perfect).`);
  console.log(`Same results with every worker count: ${same ? "yes" : "NO - determinism is broken"}`);
}

if (import.meta.main ?? process.argv[1]?.endsWith("bench.ts")) await main();

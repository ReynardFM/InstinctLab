// One experiment run: a seed, a set of rules, a number of generations. Pure: same job, same result,
// whichever thread runs it. This is why runs can be spread across CPU cores without changing the numbers.
import { createWorld, runGenerations, type Rules } from "../engine/world.ts";

export interface Job {
  seed: number;
  rules: Rules;
  gens: number;
}

export interface JobResult {
  avgHist: number[];
  bestHist: number[];
  topHalfHist: number[];
  poisonHist: number[];
}

export function runJob(job: Job): JobResult {
  const w = createWorld(job.seed, job.rules);
  runGenerations(w, job.gens);
  return { avgHist: w.avgHist, bestHist: w.bestHist, topHalfHist: w.topHalfHist, poisonHist: w.poisonHist };
}

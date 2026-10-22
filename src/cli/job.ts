// One experiment run: a seed, a set of rules, a number of generations. Pure: same job, same result,
// whichever thread runs it. This is why runs can be spread across CPU cores without changing the numbers.
import { createWorld, inEcosystem, runGenerations, runTicks, step, type Rules } from "../engine/world.ts";

export interface Job {
  seed: number;
  rules: Rules;
  gens: number; // generation mode: generations to run (ecosystem mode: ignored, the warm-up is rules.ecoWarmup)
  ticks?: number; // ecosystem mode (rules.mode 1): ticks to run after the warm-up generations
}

// Ecosystem mode: what happened after the warm-up.
export interface EcoResult {
  popHist: number[]; // population every ECO_SAMPLE (100) ticks
  ageHist: number[]; // average age, same samples
  births: number;
  deaths: number;
  oldAge: number; // deaths of creatures older than rules.ageScale
  rescues: number; // times everyone died and fresh founders were put in
}

export interface JobResult {
  avgHist: number[];
  bestHist: number[];
  topHalfHist: number[];
  poisonHist: number[];
  caughtHist?: number[]; // with hunters: share of prey caught per food map, per generation
  eco?: EcoResult; // ecosystem mode only
}

export function runJob(job: Job): JobResult {
  const w = createWorld(job.seed, job.rules);
  if (job.rules.mode === 1) {
    while (!inEcosystem(w)) step(w); // the warm-up generations
    runTicks(w, job.ticks ?? 20000);
  } else runGenerations(w, job.gens);
  const result: JobResult = { avgHist: w.avgHist, bestHist: w.bestHist, topHalfHist: w.topHalfHist, poisonHist: w.poisonHist };
  if (job.rules.hunters > 0) result.caughtHist = w.caughtHist;
  if (job.rules.mode === 1) {
    const { popHist, ageHist, births, deaths, oldAge, rescues } = w.eco;
    result.eco = { popHist, ageHist, births, deaths, oldAge, rescues };
  }
  return result;
}

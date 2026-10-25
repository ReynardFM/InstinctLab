// One experiment run: a seed, a set of rules, a number of generations. Pure: same job, same result,
// whichever thread runs it. This is why runs can be spread across CPU cores without changing the numbers.
import { createWorld, inEcosystem, runGenerations, runTicks, step, type EcoStats, type Round, type Rules } from "../engine/world.ts";
import type { HunterStats } from "../engine/hunters.ts";

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
  // with hunters (rules.hunters > 0)
  hunterPopHist?: number[]; // hunters alive, same samples as popHist
  rounds?: Round[]; // finished rounds (one side died out)
  roundStart?: number; // start of the round still running at the end
  caught?: number;
  hunterBirths?: number;
  hunterDeaths?: number;
  hunterOldAge?: number;
  ticks?: number; // ecosystem ticks run (after the warm-up)
  toxin?: EcoStats["toxin"]; // poison levels, summed over samples (toxin.ts)
  sick?: EcoStats["sick"]; // catches of sick prey vs their share, poison eaten
}

export interface JobResult {
  avgHist: number[];
  bestHist: number[];
  topHalfHist: number[];
  poisonHist: number[];
  caughtHist?: number[]; // with hunters: share of prey caught per food map, per generation
  hunterHist?: HunterStats[]; // hunters with brains: how they did, per generation they hunted in
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
  if (job.rules.hunters > 0 && job.rules.hunterBrains > 0) result.hunterHist = w.hunterHist;
  if (job.rules.mode === 1) {
    const { popHist, ageHist, births, deaths, oldAge, rescues } = w.eco;
    result.eco = { popHist, ageHist, births, deaths, oldAge, rescues };
    if (job.rules.hunters > 0) {
      const e = w.eco;
      Object.assign(result.eco, {
        hunterPopHist: e.hunterPopHist, rounds: e.rounds, roundStart: e.roundStart, caught: e.caught,
        hunterBirths: e.hunterBirths, hunterDeaths: e.hunterDeaths, hunterOldAge: e.hunterOldAge, ticks: w.tick, toxin: e.toxin, sick: e.sick,
      });
    }
  }
  return result;
}

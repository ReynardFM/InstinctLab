// THROWAWAY: exhaustive balance test for v2 (Rey 2026-10-29: "try to be exhaustive for every combo").
// Phase A: every species x every build (no card, each single card, each pair of cards) x both threat stages
//          x all 5 events, 5 seeds, fresh species per stage (carrying over was measured neutral).
// Phase B: every power used at generation 0 or 30, on each species' strong build and on its weak build
//          (the key sense missing), x both threat stages x all events, 5 seeds.
// Stage score = average of the last 4 checks after 60 generations, goal vs the species' own bot.
// Writes proto/out/tune-v2-A.json and -B.json; proto/tune-v2-report.ts prints the analysis.
//   node proto/tune-v2.ts [--seeds=5] [--phase=A|B|AB] [--sp=0,1,2] [--workers=N (default: all threads)]
import { Evolver, SPECIES, DEFAULT_SETTINGS, EVENTS, BODY_CARDS, EVERY, type BodyCard, type Card, type Sense, type EventId, type Power } from "./game/sim.ts";
import { STAGES, BUDGET, SCORE_CHECKS, stageScore } from "./game/runner.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
export const EVENT_IDS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
export const ALL_CARDS: Card[] = ["poison", "hunter", "energy", "taste", "neighbour", ...BODY_CARDS];
export const STRONG: Record<string, Card[]> = { grazer: ["poison", "hunter"], sprinter: ["poison"], scavenger: ["hunter"] };
export const WEAK: Record<string, Card[]> = { grazer: ["poison"], sprinter: [], scavenger: [] }; // key sense for the hunted stage missing
const POWER_LIST: Power[] = ["food", "shelter", "burst", "cull"];

export interface Job { phase: "A" | "B"; sp: number; cards: Card[]; stage: number; event: EventId; seed: number; power?: Power; at?: number }
export interface Result extends Job { score: number; hist: number[]; sec: number }

const isBody = (c: Card): c is BodyCard => (BODY_CARDS as Card[]).includes(c);
function run(j: Job): Result {
  const t0 = performance.now();
  const sp = SPECIES[j.sp];
  const senses = [...sp.start, ...(j.cards.filter((c) => !isBody(c)) as Sense[])];
  const order: Sense[] = ["poison", "taste", "hunter", "energy", "neighbour"];
  const build = order.filter((s) => senses.includes(s));
  const body = j.cards.filter(isBody);
  const ev = new Evolver(EVENTS[j.event].apply(STAGES[j.stage]), build, [6], j.seed, { ...DEFAULT_SETTINGS, weights: { eat: 1, avoid: 1, live: 0 }, body }, sp);
  ev.checkAfter = BUDGET - SCORE_CHECKS * EVERY; // only the 4 checks the stage score uses (same score, ~20% faster)
  while (ev.gen < BUDGET) {
    if (j.power && ev.gen === (j.at ?? 0)) ev.usePower(j.power);
    ev.step();
  }
  return { ...j, score: stageScore(ev.hist), hist: ev.hist, sec: (performance.now() - t0) / 1000 };
}

function jobs(phase: string, seeds: number, species: number[]): Job[] {
  const js: Job[] = [];
  for (const sp of species) {
    const pool = ALL_CARDS.filter((c) => !SPECIES[sp].start.includes(c as Sense));
    if (phase.includes("A")) {
      const builds: Card[][] = [[], ...pool.map((c) => [c])];
      for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) builds.push([pool[a], pool[b]]);
      for (const cards of builds) for (const stage of [1, 2]) for (const event of EVENT_IDS) for (let seed = 1; seed <= seeds; seed++) js.push({ phase: "A", sp, cards, stage, event, seed });
    }
    if (phase.includes("B"))
      for (const cards of [STRONG[SPECIES[sp].id], WEAK[SPECIES[sp].id]])
        for (const power of [undefined, ...POWER_LIST]) for (const at of power ? [0, 30] : [0])
          for (const stage of [1, 2]) for (const event of EVENT_IDS) for (let seed = 1; seed <= seeds; seed++) js.push({ phase: "B", sp, cards, stage, event, seed, power, at });
  }
  return js;
}

if (isMainThread) {
  const seeds = Number(opt("seeds", "5")), phase = opt("phase", "AB");
  const species = opt("sp", "0,1,2").split(",").map(Number); // split long runs: each background job must end within 2 hours
  const tag = species.length === SPECIES.length ? "" : `-sp${species.join("")}`;
  mkdirSync("proto/out", { recursive: true });
  for (const ph of ["A", "B"].filter((p) => phase.includes(p))) {
    const js = jobs(ph, seeds, species);
    const t0 = performance.now(), threads = Number(opt("workers", String(availableParallelism())));
    console.log(`phase ${ph}: ${js.length} runs on ${threads} threads (${cpus()[0]?.model ?? "unknown CPU"})`);
    const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
      const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
      wk.on("message", ok); wk.on("error", bad);
    })));
    writeFileSync(`proto/out/tune-v2-${ph}${tag}.json`, JSON.stringify(parts.flat()));
    console.log(`phase ${ph} done in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

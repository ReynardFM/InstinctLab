// THROWAWAY: exhaustive balance test for v2 (Rey 2026-10-29: "try to be exhaustive for every combo").
// Phase A: every species x every build (no card, each single card, each pair of cards) x both threat stages
//          x all 5 events, 5 seeds, fresh species per stage (carrying over was measured neutral).
// Phase B: every power used at generation 0 or 30, on each species' strong build and on its weak build
//          (the key sense missing), x both threat stages x all events, 5 seeds.
// Stage score = average of the last 4 checks after 60 generations, goal vs the species' own bot.
// Writes proto/out/tune-v2-A.json and -B.json; proto/tune-v2-report.ts prints the analysis.
//   node proto/tune-v2.ts [--seeds=5] [--phase=A|B|AB] [--sp=0,1,2] [--workers=N (default: all threads)] [--race=0 (run every pair on every seed)]
import { Evolver, SPECIES, DEFAULT_SETTINGS, EVENTS, BODY_CARDS, EVERY, EXPERIMENT, TEST_POWERS, type BodyCard, type Card, type Sense, type EventId, type Power, type AnyPower, type TestPower } from "./game/sim.ts";
import { STAGES, BUDGET, SCORE_CHECKS, stageScore } from "./game/runner.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, setPriority, constants } from "node:os";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
export const EVENT_IDS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
export const ALL_CARDS: Card[] = ["poison", "hunter", "energy", "taste", "neighbour", ...BODY_CARDS];
export const STRONG: Record<string, Card[]> = { grazer: ["poison", "hunter"], sprinter: ["poison"], scavenger: ["hunter"] };
export const WEAK: Record<string, Card[]> = { grazer: ["poison"], sprinter: [], scavenger: [] }; // key sense for the hunted stage missing
// Experiments (2026-10-30), set the same way in every worker thread (they get the same argv):
//   --zero=1    T1: sense weights start at 0        --sprint=1   T3: legs = sprint output, cost per use
//   --powers=test  T2: phase B tests the TEST_POWERS instead of the game's powers
//   --legs=1    phase A runs only builds with Long legs (all seeds, no racing): with --sprint=1, the only builds that change
//   --energy=rest|slow --taste=spit|avoid   call 2a: Feel energy / Taste get their own move
//   --only=energy,taste   phase A runs only builds that have one of these (start senses count), all seeds, no racing
//   --nbinfo=1 --confuse=1 --follow=1   See neighbour experiments A and B (see sim.ts EXPERIMENT)
//   --workers=N  threads (default: half of the machine's threads, at low priority, so other apps stay usable;
//                Rey 2026-10-30: all threads nearly froze his laptop)
//   --out=DIR   where the JSON goes (default proto/out)
EXPERIMENT.zeroSenses = opt("zero", "0") === "1";
EXPERIMENT.sprintLegs = opt("sprint", "0") === "1";
EXPERIMENT.energyMove = opt("energy", "") as typeof EXPERIMENT.energyMove;
EXPERIMENT.tasteMove = opt("taste", "") as typeof EXPERIMENT.tasteMove;
EXPERIMENT.neighbourInfo = opt("nbinfo", "0") === "1";
EXPERIMENT.confusion = opt("confuse", "0") === "1";
EXPERIMENT.follow = opt("follow", "0") === "1";
EXPERIMENT.ownThreats = opt("threats", "0") === "1"; // call 5a: sprinter ambush hunters, scavenger toxin build-up
EXPERIMENT.terrain = opt("terrain", "").split(",").filter(Boolean); // --terrain=river,farm,zone (adds the See terrain card)
if (EXPERIMENT.terrain.length) ALL_CARDS.push("terrain");
EXPERIMENT.farmRaid = Number(opt("raid", "0")); // --raid=20: hunters find the farm 20 generations into the stage
EXPERIMENT.legsGrow = Number(opt("legsgrow", "0"));
EXPERIMENT.thirst = opt("thirst", "0") === "1"; // --thirst=1 (needs --terrain with river): water meter, drink in the river
EXPERIMENT.terrainMoves = opt("tmoves", "0") === "1";
EXPERIMENT.memory = Number(opt("memory", "0")); // --memory=2: 2 memory cells (outputs fed back as inputs next tick) // --tmoves=1: See terrain brings go-to-zone, go-to-farm, out-of-water moves // --legsgrow=120: legs' speed bonus grows over 120 generations
const pair = (k: string) => { const v = opt(k, ""); return v ? (v.split("/").map(Number) as [number, number]) : null; };
EXPERIMENT.legs = pair("legsx"); // --legsx=1.1/1.5   (speed x / hunger x)
EXPERIMENT.stomach = pair("stomachx"); // --stomachx=0.75/0.8   (poison hurt x / food x)
const POWER_LIST: AnyPower[] = opt("powers", "game") === "test" ? (Object.keys(TEST_POWERS) as TestPower[]) : (["food", "shelter", "burst", "cull"] satisfies Power[]);

export interface Job { phase: "A" | "B"; sp: number; cards: Card[]; stage: number; event: EventId; seed: number; power?: AnyPower; at?: number }
export interface Result extends Job { score: number; hist: number[]; sec: number }

const isBody = (c: Card): c is BodyCard => (BODY_CARDS as Card[]).includes(c);
function start(j: Job): Evolver {
  const sp = SPECIES[j.sp];
  const senses = [...sp.start, ...(j.cards.filter((c) => !isBody(c)) as Sense[])];
  const order: Sense[] = ["poison", "taste", "hunter", "energy", "terrain", "neighbour"];
  const build = order.filter((s) => senses.includes(s));
  const body = j.cards.filter(isBody);
  const ev = new Evolver(EVENTS[j.event].apply(STAGES[j.stage]), build, [6], j.seed, { ...DEFAULT_SETTINGS, weights: { eat: 1, avoid: 1, live: 0 }, body }, sp);
  ev.checkAfter = BUDGET - SCORE_CHECKS * EVERY; // only the 4 checks the stage score uses (same score, ~20% faster)
  return ev;
}
function finish(j: Job, ev: Evolver, t0: number): Result {
  while (ev.gen < BUDGET) {
    if (j.power && ev.gen === (j.at ?? 0)) ev.usePower(j.power);
    ev.step();
  }
  return { ...j, score: stageScore(ev.hist), hist: ev.hist, sec: (performance.now() - t0) / 1000 };
}
export function run(j: Job): Result { const t0 = performance.now(); return finish(j, start(j), t0); }

// Runs that differ only by a power used later share every generation before it: evolve those once,
// then branch (fork) per power. Same results as running each job alone, fewer generations.
export function runGroup(js: Job[]): Result[] {
  const base = js.find((j) => !j.power), later = js.filter((j) => j.power && (j.at ?? 0) > 0);
  if (!base || !later.length) return js.map(run);
  const out = new Map<Job, Result>();
  for (const j of js) if (j !== base && !later.includes(j)) out.set(j, run(j));
  const t0 = performance.now(), ev = start(base);
  while (ev.gen < BUDGET) {
    for (const j of later) if (j.at === ev.gen) { const t1 = performance.now(); const r = finish(j, ev.fork(), t1); r.sec += (t1 - t0) / 1000; out.set(j, r); }
    ev.step();
  }
  out.set(base, { ...base, score: stageScore(ev.hist), hist: ev.hist, sec: (performance.now() - t0) / 1000 });
  return js.map((j) => out.get(j)!);
}

function builds(sp: number): Card[][] {
  const pool = ALL_CARDS.filter((c) => !SPECIES[sp].start.includes(c as Sense));
  const out: Card[][] = [[], ...pool.map((c) => [c])];
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) out.push([pool[a], pool[b]]);
  return out;
}
const seedRange = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
function jobsA(species: number[], cardsOf: (sp: number) => Card[][], seeds: number[]): Job[] {
  const js: Job[] = [];
  for (const sp of species) for (const cards of cardsOf(sp)) for (const stage of [1, 2]) for (const event of EVENT_IDS) for (const seed of seeds) js.push({ phase: "A", sp, cards, stage, event, seed });
  return js;
}
function jobsB(species: number[], seeds: number): Job[] {
  const js: Job[] = [];
  for (const sp of species)
    for (const cards of [STRONG[SPECIES[sp].id], WEAK[SPECIES[sp].id]])
      for (const power of [undefined, ...POWER_LIST]) for (const at of power ? [0, 30] : [0])
        for (const stage of [1, 2]) for (const event of EVENT_IDS) for (let seed = 1; seed <= seeds; seed++) js.push({ phase: "B", sp, cards, stage, event, seed, power, at });
  return js;
}

// A pool of worker threads that each take the next job when free (heavy runs don't pile up on one thread).
// A pool of worker threads that each take the next unit when free (heavy units don't pile up on one thread).
// A unit is a list of jobs one worker runs together (phase B: the jobs that can share generations).
// Results come back in job order, so the output file is the same every time.
async function runAll(js: Job[], threads: number, units: Job[][] = js.map((j) => [j])): Promise<Result[]> {
  const res: Result[][] = new Array(units.length);
  let next = 0, done = 0, runs = 0;
  return new Promise((ok, bad) => {
    for (let w = 0; w < Math.min(threads, units.length); w++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < units.length) { mine = next++; wk.postMessage(units[mine]); } else wk.terminate(); };
      wk.on("message", (r: Result[]) => {
        res[mine] = r; done++; runs += r.length;
        if (process.stdout.isTTY) process.stdout.write(`\r  ${runs} of ${js.length} runs`);
        if (done === units.length) { if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(40) + "\r"); ok(res.flat()); }
        feed();
      });
      wk.on("error", bad);
      feed();
    }
    if (!units.length) ok([]);
  });
}

const RACE_GAP = 0.25; // a pair this far behind the leader after 2 seeds is dropped (it cannot be among the best)
const key = (c: Card[]) => [...c].sort().join("+");

const isEntry = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("proto/tune-v2.ts"); // run directly, not imported by a check script
if (isMainThread && isEntry) {
  const seeds = Number(opt("seeds", "5")), phase = opt("phase", "AB");
  const species = opt("sp", "0,1,2").split(",").map(Number);
  const tag = species.length === SPECIES.length ? "" : `-sp${species.join("")}`;
  const threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: run at normal priority */ }
  const only = (opt("legs", "0") === "1" ? ["legs"] : opt("only", "").split(",").filter(Boolean)) as Card[];
  const legsOnly = only.length > 0, race = opt("race", "1") !== "0" && !legsOnly;
  const OUT = opt("out", "proto/out");
  const pool = legsOnly ? (sp: number) => builds(sp).filter((b) => [...b, ...SPECIES[sp].start].some((c) => only.includes(c))) : builds;
  mkdirSync(OUT, { recursive: true });
  console.log(`${threads} of ${availableParallelism()} threads, low priority, ${cpus()[0]?.model ?? "unknown CPU"}; experiments: ${JSON.stringify(EXPERIMENT)}, powers ${POWER_LIST.join(" ")}${legsOnly ? `, only builds with ${only.join(" or ")}` : ""} -> ${OUT}`);
  if (phase.includes("A")) {
    const t0 = performance.now();
    let all: Result[];
    if (!race) all = await runAll(jobsA(species, pool, seedRange(1, seeds)), threads);
    else {
      // Racing: no card and every single card get all seeds (every pair is compared with them);
      // pairs get 2 seeds first, and only pairs close to the leader of their stage/event get the rest.
      const r1 = await runAll([
        ...jobsA(species, (sp) => builds(sp).filter((b) => b.length < 2), seedRange(1, seeds)),
        ...jobsA(species, (sp) => builds(sp).filter((b) => b.length === 2), seedRange(1, 2)),
      ], threads);
      const keep = new Set<string>();
      for (const sp of species) for (const stage of [1, 2]) for (const event of EVENT_IDS) {
        const R = r1.filter((r) => r.sp === sp && r.stage === stage && r.event === event);
        const mean = (k: string) => { const xs = R.filter((r) => key(r.cards) === k && r.seed <= 2).map((r) => r.score); return xs.reduce((a, b) => a + b, 0) / xs.length; };
        const ks = builds(sp).map(key), lead = Math.max(...ks.map(mean));
        for (const b of builds(sp).filter((b) => b.length === 2)) if (mean(key(b)) >= lead - RACE_GAP) keep.add(`${sp}|${stage}|${event}|${key(b)}`);
      }
      const r2Jobs = jobsA(species, (sp) => builds(sp).filter((b) => b.length === 2), seedRange(3, seeds)).filter((j) => keep.has(`${j.sp}|${j.stage}|${j.event}|${key(j.cards)}`));
      console.log(`phase A racing: ${r1.length} runs, then ${r2Jobs.length} more for the ${keep.size} pair/stage/event cells close to the leader (instead of ${jobsA(species, builds, seedRange(1, seeds)).length} runs in all)`);
      all = [...r1, ...(await runAll(r2Jobs, threads))];
    }
    writeFileSync(`${OUT}/tune-v2-A${tag}.json`, JSON.stringify(all));
    console.log(`phase A: ${all.length} runs in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
  if (phase.includes("B")) {
    const t0 = performance.now(), js = jobsB(species, seeds);
    // group the runs that differ only by power, so each group shares its first generations
    const groups = new Map<string, Job[]>();
    for (const j of js) { const k = `${j.sp}|${key(j.cards)}|${j.stage}|${j.event}|${j.seed}`; groups.set(k, [...(groups.get(k) ?? []), j]); }
    writeFileSync(`${OUT}/tune-v2-B${tag}.json`, JSON.stringify(await runAll(js, threads, [...groups.values()])));
    console.log(`phase B: ${js.length} runs in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
} else if (!isMainThread) {
  // a list = a unit of jobs; a single job = sent by an older copy of this script still running (same results)
  parentPort!.on("message", (m: Job[] | Job) => parentPort!.postMessage(Array.isArray(m) ? runGroup(m) : run(m)));
}

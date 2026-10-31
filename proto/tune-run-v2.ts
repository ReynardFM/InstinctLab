// Whole-run test (Rey 2026-10-30, call 2c: sort cards into useful now / trap / long-term investment).
// One species plays Meadow -> Poison patch -> Hunted with its population carried over, one card picked before
// each stage. The card picked before the Meadow (x) varies; the next two picks are the species' usual good
// picks (if x is one of them, that later pick is empty: the card was already taken).
// For every x: stage scores vs picking nothing first, paired by seed. A card that does nothing in the Meadow
// but helps later is an investment; one that never changes anything is a trap; one that ever hurts is harmful.
// --timing=1 (Rey 2026-10-30, investment cards): instead, every card x is added either before the Meadow or before
// Hunted, on top of the usual picks, so both runs own the same cards on Hunted and only the timing differs.
// An investment card scores better on Hunted when it was taken early.
//   node proto/tune-run-v2.ts [--seeds=5] [--events=calm|all] [--workers=N] [--out=proto/out/run] [--timing=1] [--legsgrow=120]
import { Evolver, SPECIES, DEFAULT_SETTINGS, BODY_CARDS, EVERY, CARD_INFO, EXPERIMENT, type Card, type Sense, type BodyCard, type EventId } from "./game/sim.ts";
import { BUDGET, SCORE_CHECKS, stageLevel, stageScore, STAGES } from "./game/runner.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism, setPriority, constants } from "node:os";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const ALL: Card[] = ["poison", "hunter", "energy", "taste", "neighbour", ...BODY_CARDS];
EXPERIMENT.terrain = opt("terrain", "").split(",").filter(Boolean); // --terrain=river,farm,zone
if (EXPERIMENT.terrain.length) ALL.push("terrain");
EXPERIMENT.legsGrow = Number(opt("legsgrow", "0"));
EXPERIMENT.farmRaid = Number(opt("raid", "0"));
const TIMING = opt("timing", "0") === "1";
const LATER: Record<string, Card[]> = { grazer: ["poison", "hunter"], sprinter: ["poison", "stomach"], scavenger: ["legs", "hunter"] }; // picks before stages 2 and 3 (round 2's best single cards)
const EVS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
interface Job { sp: number; x: Card | null; event: EventId; seed: number; at?: number } // at: stage x is added (timing mode)
interface Result extends Job { scores: number[] }
const isBody = (c: Card): c is BodyCard => (BODY_CARDS as Card[]).includes(c);

function run(j: Job): Result {
  const sp = SPECIES[j.sp];
  const picks: (Card | null)[] = j.at === undefined ? [j.x, ...LATER[sp.id].map((c) => (c === j.x ? null : c))] : [null, ...LATER[sp.id]];
  const order: Sense[] = ["poison", "taste", "hunter", "energy", "terrain", "neighbour"];
  const scores: number[] = [];
  let ev: Evolver | null = null;
  for (let s = 0; s < 3; s++) {
    const owned = picks.slice(0, s + 1).filter((c): c is Card => c !== null);
    if (j.at !== undefined && j.x && s >= j.at && !owned.includes(j.x)) owned.push(j.x);
    const build = order.filter((x) => sp.start.includes(x) || owned.includes(x));
    const set = { ...DEFAULT_SETTINGS, weights: { eat: 1, avoid: 1, live: 0 }, body: owned.filter(isBody) };
    const lv = stageLevel(s, j.event);
    if (!ev) ev = new Evolver(lv, build, [6], j.seed, set, sp);
    else { ev.set = set; ev.nextStage(lv, build); }
    const from = ev.hist.length, end = ev.gen + BUDGET;
    ev.checkAfter = end - SCORE_CHECKS * EVERY; // only the checks the stage score uses (same score)
    while (ev.gen < end) ev.step();
    scores.push(stageScore(ev.hist.slice(from)));
  }
  return { ...j, scores };
}

if (isMainThread) {
  const seeds = Number(opt("seeds", "5")), events = opt("events", "calm") === "all" ? EVS : [opt("events", "calm") as EventId];
  const threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal priority */ }
  const js: Job[] = [];
  for (let sp = 0; sp < SPECIES.length; sp++) for (const x of [null, ...ALL.filter((c) => !SPECIES[sp].start.includes(c as Sense))]) for (const event of events) for (let seed = 1; seed <= seeds; seed++) {
    if (!TIMING) js.push({ sp, x, event, seed });
    else if (x) for (const at of [0, 2]) js.push({ sp, x, event, seed, at });
  }
  console.log(`${js.length} whole runs (3 stages each) on ${threads} of ${availableParallelism()} threads, low priority`);
  // progress goes to stderr, so it shows on screen even when the report (stdout) is saved to a file
  console.error(`${js.length} whole runs (3 stages each) on ${threads} threads; progress below (Rey 2026-10-30: the batch showed nothing)`);
  const t0 = performance.now(), res: Result[] = new Array(js.length);
  let next = 0, done = 0;
  await new Promise<void>((ok, bad) => {
    for (let w = 0; w < Math.min(threads, js.length); w++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < js.length) { mine = next++; wk.postMessage(js[mine]); } else wk.terminate(); };
      wk.on("message", (r: Result) => {
        res[mine] = r; done++;
        if (done % 10 === 0 || done === js.length) process.stderr.write(`\r  ${done} of ${js.length} whole runs, ${((performance.now() - t0) / 60000).toFixed(1)} min${done === js.length ? "\n" : ""}`);
        if (done === js.length) ok();
        feed();
      });
      wk.on("error", bad);
      feed();
    }
  });
  const OUT = opt("out", "proto/out/run");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/tune-run-v2.json`, JSON.stringify(res));
  console.log(`done in ${((performance.now() - t0) / 60000).toFixed(1)} min\n`);
  if (TIMING) { // early minus late on Hunted, paired by event and seed
    const f2 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
    const avg2 = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    console.log(`Hunted score with the card taken before the Meadow minus taken before Hunted (same cards on Hunted; * = probably real). Positive = investment.`);
    for (let sp = 0; sp < SPECIES.length; sp++) {
      console.log(`\n${SPECIES[sp].name}`);
      for (const x of ALL.filter((c) => !SPECIES[sp].start.includes(c as Sense))) {
        const late = new Map(res.filter((r) => r.sp === sp && r.x === x && r.at === 2).map((r) => [`${r.event}|${r.seed}`, r.scores[2]]));
        const d = res.filter((r) => r.sp === sp && r.x === x && r.at === 0).map((r) => r.scores[2] - late.get(`${r.event}|${r.seed}`)!);
        const m = margin(d, 0.05);
        console.log(`  ${CARD_INFO[x].name.padEnd(16)}${f2(avg2(d))} ±${m.toFixed(3)}${Math.abs(avg2(d)) > m ? (avg2(d) > 0 ? " * investment" : " * better late") : ""}`);
      }
    }
    process.exit(0);
  }
  // report: each first pick vs nothing first, paired by event and seed
  const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`change in stage score from picking x before the Meadow (vs nothing), paired by seed; * = probably real. Later picks: ${Object.entries(LATER).map(([k, v]) => `${k} ${v.join(", ")}`).join(" | ")}`);
  for (let sp = 0; sp < SPECIES.length; sp++) {
    console.log(`\n${SPECIES[sp].name}${" ".repeat(18 - SPECIES[sp].name.length)}${STAGES.map((s) => s.name.padEnd(18)).join("")}verdict`);
    const base = new Map(res.filter((r) => r.sp === sp && r.x === null).map((r) => [`${r.event}|${r.seed}`, r.scores]));
    for (const x of ALL.filter((c) => !SPECIES[sp].start.includes(c as Sense))) {
      const R = res.filter((r) => r.sp === sp && r.x === x);
      const cells = [0, 1, 2].map((s) => { const d = R.map((r) => r.scores[s] - base.get(`${r.event}|${r.seed}`)![s]); const m = margin(d, 0.05); return { v: avg(d), real: Math.abs(avg(d)) > m }; });
      const hurt = cells.some((c) => c.real && c.v < 0), helpNow = cells[0].real && cells[0].v > 0, helpLater = cells.slice(1).some((c) => c.real && c.v > 0);
      const quiet = cells.every((c) => !c.real && Math.abs(c.v) <= 0.02);
      const verdict = hurt ? "HARMFUL somewhere" : helpNow ? "useful now" : helpLater ? "investment (pays later)" : quiet ? "trap (does nothing)" : "unclear";
      console.log(`  ${CARD_INFO[x].name.padEnd(16)}${cells.map((c) => `${f(c.v)}${c.real ? "*" : " "}`.padEnd(18)).join("")}${verdict}`);
    }
  }
} else {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(run(j)));
}

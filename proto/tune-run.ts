// THROWAWAY: roguelite brief, cheapest test (2026-10-29). One species runs through 3 stages with a fixed
// generation budget each and keeps its brains between stages. Stage score = average of the last 4 checks
// at the end of the budget (no lucky single check). Questions: which budget and bar make right choices pass
// and wrong ones fail on >= 4 of 5 seeds? Does carrying the species over beat starting fresh each stage?
//   node proto/tune-run.ts [--seeds=5]
import { Evolver, BAR, type Level, type Sense } from "./game/sim.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";

const STAGES: Level[] = [
  { id: "S1", name: "Meadow", good: 40, bad: 0, hunters: 0, menu: ["energy"], blurb: "" },
  { id: "S2", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"], blurb: "" },
  { id: "S3", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"], blurb: "" },
];
const PATHS: { name: string; builds: Sense[][]; fresh?: boolean }[] = [
  { name: "right (poison, then hunter)", builds: [[], ["poison"], ["poison", "hunter"]] },
  { name: "trap at 2 (taste)", builds: [[], ["taste"], ["taste", "hunter"]] },
  { name: "trap at 3 (energy)", builds: [[], ["poison"], ["poison", "energy"]] },
  { name: "right, fresh each stage", builds: [[], ["poison"], ["poison", "hunter"]], fresh: true },
];
const BUDGETS = [40, 60, 100];
const BARS = [0.6, 0.7, 0.8];
interface Job { path: number; budget: number; seed: number }
interface Result extends Job { score: number[]; sec: number[] }

const avgLast = (h: number[], k = 4) => { const w = h.slice(-k); return w.reduce((s, x) => s + x, 0) / w.length; };

function run(j: Job): Result {
  const p = PATHS[j.path];
  const score: number[] = [], sec: number[] = [];
  let ev: Evolver | null = null;
  for (let s = 0; s < STAGES.length; s++) {
    const t0 = performance.now();
    if (!ev || p.fresh) ev = new Evolver(STAGES[s], p.builds[s], [6], j.seed);
    else ev.nextStage(STAGES[s], p.builds[s]);
    const start = ev.hist.length, end = ev.gen + j.budget;
    while (ev.gen < end) ev.step();
    score.push(avgLast(ev.hist.slice(start)));
    sec.push((performance.now() - t0) / 1000);
  }
  return { ...j, score, sec };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs in ${f(wall, 0)} s. Stage score = average of the last 4 checks (every 5 generations) at the end of the stage's budget; progress vs that stage's hand-written bot on unseen maps.`);
  for (const b of BUDGETS) {
    console.log(`\n== ${b} generations per stage`);
    for (let pi = 0; pi < PATHS.length; pi++) {
      const V = rs.filter((r) => r.budget === b && r.path === pi).sort((x, y) => x.seed - y.seed);
      const cells = STAGES.map((st, s) => {
        const xs = V.map((r) => r.score[s]);
        const pass = BARS.map((bar) => V.filter((r) => r.score[s] >= bar).length).join("/");
        return `${st.name} ${f(avg(xs))} ±${f(margin(xs, 0.05))} pass ${pass} (${f(avg(V.map((r) => r.sec[s])), 1)} s)`;
      });
      console.log(`  ${PATHS[pi].name.padEnd(28)} ${cells.join(" | ")}`);
    }
  }
  console.log(`\npass = seeds (of ${rs.filter((r) => r.budget === BUDGETS[0] && r.path === 0).length}) at or above bars ${BARS.join(" / ")}. Bar used so far: ${BAR}.`);
  // carried over vs fresh, paired by seed, per stage
  for (const b of BUDGETS) {
    const R = rs.filter((r) => r.budget === b && r.path === 0).sort((x, y) => x.seed - y.seed);
    const F = rs.filter((r) => r.budget === b && r.path === 3).sort((x, y) => x.seed - y.seed);
    console.log(`  ${b} gens: carried over minus fresh: ` + STAGES.map((st, s) => { const d = R.map((r, i) => r.score[s] - F[i].score[s]); const m = margin(d, 0.05); return `${st.name} ${f(avg(d))} ±${f(m)}${Math.abs(avg(d)) > m ? " *" : ""}`; }).join(" | "));
  }
}

if (isMainThread) {
  const a = process.argv.find((x) => x.startsWith("--seeds="));
  const seeds = a ? Number(a.slice(8)) : 5;
  const js: Job[] = [];
  for (const budget of BUDGETS) for (let path = 0; path < PATHS.length; path++) for (let seed = 1; seed <= seeds; seed++) js.push({ path, budget, seed });
  const t0 = performance.now(), threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  mkdirSync("proto/out", { recursive: true });
  writeFileSync("proto/out/tune-run.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

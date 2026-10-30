// THROWAWAY: species balance test (Rey 2026-10-29: 2-3 species, balanced and tested; the page is a demo).
// Each species runs meadow -> poison patch -> hunted, 60 generations per stage, carrying its population.
// Before stages 2 and 3 it picks one sense card from that stage's menu (minus what it already has).
// Stage score = average of the last 4 checks, as goal value vs the species' own bot on unseen maps.
//   node proto/tune-species.ts [--seeds=5] [--budget=60]
import { Evolver, SPECIES, DEFAULT_SETTINGS, type Level, type Sense, type Weights } from "./game/sim.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const BUDGET = opt("budget", 60);
export const STAGES: Level[] = [
  { id: "S1", name: "Meadow", good: 40, bad: 0, hunters: 0, menu: ["energy"], blurb: "" },
  { id: "S2", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"], blurb: "" },
  { id: "S3", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"], blurb: "" },
];
const MIXES: [string, Weights][] = [["eat50 avoid50", { eat: 1, avoid: 1, live: 0 }], ["eat only", { eat: 1, avoid: 0, live: 0 }], ["eat30 avoid20 live50", { eat: 0.3, avoid: 0.2, live: 0.5 }]];

// every sense path the cards allow: stage 2 pick, then stage 3 pick, never a sense already owned
function paths(start: Sense[]): Sense[][] {
  const out: Sense[][] = [];
  for (const a of STAGES[1].menu.filter((s) => !start.includes(s)))
    for (const b of STAGES[2].menu.filter((s) => !start.includes(s) && s !== a)) out.push([a, b]);
  return out;
}
interface Job { sp: number; picks: Sense[]; mix: number; seed: number }
interface Result extends Job { score: number[] }
const avgLast = (h: number[], k = 4) => { const w = h.slice(-k); return w.reduce((s, x) => s + x, 0) / w.length; };

function run(j: Job): Result {
  const sp = SPECIES[j.sp], start = sp.start;
  const builds = [start, [...start, j.picks[0]], [...start, ...j.picks]];
  const ev = new Evolver(STAGES[0], builds[0], [6], j.seed, { ...DEFAULT_SETTINGS, weights: MIXES[j.mix][1] }, sp);
  const score: number[] = [];
  for (let s = 0; s < 3; s++) {
    if (s > 0) ev.nextStage(STAGES[s], builds[s]);
    const from = ev.hist.length, end = ev.gen + BUDGET;
    while (ev.gen < end) ev.step();
    score.push(avgLast(ev.hist.slice(from)));
  }
  return { ...j, score };
}

const f = (x: number) => x.toFixed(2);
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs, ${BUDGET} generations per stage, ${f(wall / 60)} min. Score = goal vs the species' own bot (avg of last 4 checks). Per-seed values sorted low -> high.`);
  for (let si = 0; si < SPECIES.length; si++) {
    const sp = SPECIES[si];
    console.log(`\n######## ${sp.name} (goal ${sp.goal}, starts with ${sp.start.join(", ") || "food only"})`);
    for (let m = 0; m < MIXES.length; m++) {
      console.log(`  -- reward ${MIXES[m][0]}`);
      for (const p of paths(sp.start)) {
        const V = rs.filter((r) => r.sp === si && r.mix === m && r.picks.join() === p.join());
        const cell = (s: number) => { const xs = V.map((r) => r.score[s]).sort((a, b) => a - b); return `${f(avg(xs))} ±${f(margin(xs, 0.05))} [${xs.map(f).join(" ")}]`; };
        console.log(`    then ${p[0].padEnd(6)} then ${p[1].padEnd(6)} | meadow ${cell(0)} | poison ${cell(1)} | hunted ${cell(2)}`);
      }
    }
  }
}

if (isMainThread) {
  const seeds = opt("seeds", 5);
  const js: Job[] = [];
  for (let sp = 0; sp < SPECIES.length; sp++) for (let mix = 0; mix < MIXES.length; mix++) for (const picks of paths(SPECIES[sp].start)) for (let seed = 1; seed <= seeds; seed++) js.push({ sp, picks, mix, seed });
  const t0 = performance.now(), threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  mkdirSync("proto/out", { recursive: true });
  writeFileSync("proto/out/tune-species.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

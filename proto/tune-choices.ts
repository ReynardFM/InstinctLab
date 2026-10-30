// THROWAWAY: brief A's cheapest test (2026-10-28). Do the new player choices matter, and does the best
// setting change with the level or the senses? One choice changed at a time from today's defaults:
//   reward: balanced (default) / glutton / survivor     mutation: 0.3 (default) / 0.1 / 0.9
//   population: 30 (default) / 15 / 60, at the same compute (9000 creature-rounds: 300 / 600 / 150 generations)
// Progress is always the level's goal (clean score vs the bot on 2 unseen maps), whatever evolution rewards.
//   node proto/tune-choices.ts [--seeds=5]
import { Evolver, LEVELS, DEFAULT_SETTINGS, BAR, EVERY, type Sense, type Settings } from "./game/sim.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";

const BUDGET = Number(process.argv.find((x) => x.startsWith("--budget="))?.slice(9) ?? 9000); // creatures x generations
const SETTINGS: { name: string; set: Settings }[] = [
  { name: "default", set: DEFAULT_SETTINGS },
  { name: "reward glutton", set: { ...DEFAULT_SETTINGS, reward: "glutton" } },
  { name: "reward survivor", set: { ...DEFAULT_SETTINGS, reward: "survivor" } },
  { name: "mutation 0.1", set: { ...DEFAULT_SETTINGS, mutation: 0.1 } },
  { name: "mutation 0.9", set: { ...DEFAULT_SETTINGS, mutation: 0.9 } },
  { name: "pop 15 (600 gens)", set: { ...DEFAULT_SETTINGS, pop: 15 } },
  { name: "pop 60 (150 gens)", set: { ...DEFAULT_SETTINGS, pop: 60 } },
];
const KNOBS: Record<string, string[]> = {
  reward: ["default", "reward glutton", "reward survivor"],
  mutation: ["mutation 0.1", "default", "mutation 0.9"],
  population: ["pop 15 (600 gens)", "default", "pop 60 (150 gens)"],
};
const BUILDS: Sense[][][] = [[["poison", "energy"], ["poison", "taste"]], [["poison", "hunter"], ["hunter", "energy"]]];

interface Job { level: number; build: Sense[]; setting: number; seed: number }
interface Result extends Job { hist: number[]; pop: number; sec: number; bad: number; hunted: number }

function run(j: Job): Result {
  const t0 = performance.now();
  const set = SETTINGS[j.setting].set;
  const ev = new Evolver(LEVELS[j.level], j.build, [6], j.seed, set);
  const gens = Math.round(BUDGET / set.pop);
  while (ev.gen < gens) ev.step();
  // how the best brain plays the goal: poison eaten and caught, per creature (from its last check)
  return { ...j, hist: ev.hist, pop: set.pop, sec: (performance.now() - t0) / 1000, bad: ev.champStats!.bad, hunted: ev.champStats!.hunted };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pm = (xs: number[]) => `${f(avg(xs))} ±${f(margin(xs, 0.05))}`;
const best = (r: Result) => Math.max(...r.hist);
// share of the compute budget used when progress first reached the bar (1 = never within budget)
const learnAt = (r: Result) => { const i = r.hist.findIndex((x) => x >= BAR); return i < 0 ? NaN : ((i + 1) * EVERY * r.pop) / BUDGET; };

function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs in ${f(wall, 0)} s. Same compute per run (${BUDGET} creature-rounds). best = highest progress (goal: clean score vs bot, unseen maps); learned = reached ${BAR}; at = share of the budget used when it first got there.`);
  const verdicts: string[] = [];
  for (let lv = 0; lv < LEVELS.length; lv++)
    for (const b of BUILDS[lv]) {
      const key = b.join("+");
      const R = rs.filter((r) => r.level === lv && r.build.join("+") === key);
      console.log(`\n== ${LEVELS[lv].name}, food+${key}`);
      const by = (name: string) => R.filter((r) => SETTINGS[r.setting].name === name).sort((x, y) => x.seed - y.seed);
      const base = by("default").map(best);
      for (const s of SETTINGS) {
        const V = by(s.name);
        const ats = V.map(learnAt).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
        const d = V.map((r, i) => best(r) - base[i]);
        const real = s.name !== "default" && Math.abs(avg(d)) > margin(d, 0.05) ? " *" : "";
        console.log(`  ${s.name.padEnd(19)} learned ${V.filter((r) => Number.isFinite(learnAt(r))).length}/${V.length} at ${ats.length ? f(ats[Math.floor(ats.length / 2)]) : "-"} | best ${pm(V.map(best))}` +
          (s.name === "default" ? "" : ` | vs default ${pm(d)}${real}`) + ` | poison/creature ${f(avg(V.map((r) => r.bad)), 1)}` + (LEVELS[lv].hunters ? ` caught ${f(avg(V.map((r) => r.hunted)), 2)}` : "") + ` | ${f(avg(V.map((r) => r.sec)), 1)} s`);
      }
      for (const [knob, names] of Object.entries(KNOBS)) {
        const scores = names.map((n) => ({ n, m: avg(by(n).map(best)) })).sort((a, c) => c.m - a.m);
        verdicts.push(`${LEVELS[lv].name.padEnd(13)} food+${key.padEnd(14)} ${knob.padEnd(10)} best: ${scores[0].n} (${f(scores[0].m)}), then ${scores[1].n} (${f(scores[1].m)})`);
      }
    }
  console.log("\n== best setting of each choice, per level and senses (mean best progress; see * above for which differences are real)");
  for (const v of verdicts) console.log("  " + v);
}

if (isMainThread) {
  const a = process.argv.find((x) => x.startsWith("--seeds="));
  const seeds = a ? Number(a.slice(8)) : 5;
  const js: Job[] = [];
  for (let level = 0; level < LEVELS.length; level++) for (const build of BUILDS[level]) for (let setting = 0; setting < SETTINGS.length; setting++) for (let seed = 1; seed <= seeds; seed++) js.push({ level, build, setting, seed });
  const t0 = performance.now(), threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  mkdirSync("proto/out", { recursive: true });
  writeFileSync("proto/out/tune-choices.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

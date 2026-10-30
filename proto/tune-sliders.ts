// THROWAWAY: cheapest test for the reward sliders (Rey 2026-10-29). Each mix sets how much evolution
// rewards eating / avoiding poison / staying alive (parts scaled 0..1, see sim.ts). The level goal never
// changes (clean score vs the bot on unseen maps). Questions: do mixes differ? does the best mix change
// with the level or the senses? which mix is closest to today's fixed reward (food - poison)?
//   node proto/tune-sliders.ts [--seeds=5] [--gens=300]
import { Evolver, LEVELS, DEFAULT_SETTINGS, BAR, type Sense, type Settings, type Weights } from "./game/sim.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const GENS = opt("gens", 300);
const W = (eat: number, avoid: number, live: number): Weights => ({ eat, avoid, live });
const MIXES: { name: string; set: Settings }[] = [
  { name: "eat 50 avoid 50 (today)", set: DEFAULT_SETTINGS }, // identical runs to weights 1/1/0 (checked)
  ...([
    ["eat only", W(1, 0, 0)], ["avoid only", W(0, 1, 0)], ["live only", W(0, 0, 1)],
    ["eat 70 avoid 30", W(0.7, 0.3, 0)], ["eat 30 avoid 70", W(0.3, 0.7, 0)], ["equal thirds", W(1, 1, 1)],
    ["eat 40 avoid 40 live 20", W(0.4, 0.4, 0.2)], ["eat 50 live 50", W(0.5, 0, 0.5)], ["avoid 50 live 50", W(0, 0.5, 0.5)],
  ] as [string, Weights][]).map(([name, weights]) => ({ name, set: { ...DEFAULT_SETTINGS, weights } })),
];
const BUILDS: Sense[][][] = [[["poison", "energy"], ["poison", "taste"]], [["poison", "hunter"], ["hunter", "energy"]]];
interface Job { level: number; build: Sense[]; mix: number; seed: number }
interface Result extends Job { hist: number[]; bad: number; life: number; good: number }

function run(j: Job): Result {
  const ev = new Evolver(LEVELS[j.level], j.build, [6], j.seed, MIXES[j.mix].set);
  while (ev.gen < GENS) ev.step();
  const c = ev.champStats!;
  return { ...j, hist: ev.hist, bad: c.bad, good: c.good, life: c.life };
}
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pm = (xs: number[]) => `${f(avg(xs))} ±${f(margin(xs, 0.05))}`;
const best = (r: Result) => Math.max(...r.hist);

function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs, ${GENS} generations, ${f(wall, 0)} s. best = highest progress on the level goal (clean score vs bot, unseen maps); * = differs from 50/50 (= today's reward), paired by seed.`);
  const tops: string[] = [];
  for (let lv = 0; lv < LEVELS.length; lv++)
    for (const b of BUILDS[lv]) {
      const key = b.join("+");
      const by = (m: number) => rs.filter((r) => r.level === lv && r.build.join("+") === key && r.mix === m).sort((x, y) => x.seed - y.seed);
      const base = by(0).map(best);
      console.log(`\n== ${LEVELS[lv].name}, food+${key}`);
      const rows = MIXES.map((m, i) => {
        const V = by(i), d = V.map((r, k) => best(r) - base[k]);
        const real = i > 0 && Math.abs(avg(d)) > margin(d, 0.05) ? " *" : "";
        console.log(`  ${m.name.padEnd(24)} learned ${V.filter((r) => r.hist.some((x) => x >= BAR)).length}/${V.length} | best ${pm(V.map(best))}` + (i ? ` | vs 50/50 ${pm(d)}${real}` : "") +
          ` | food ${f(avg(V.map((r) => r.good)), 1)} poison ${f(avg(V.map((r) => r.bad)), 1)} alive ${f(avg(V.map((r) => r.life)) / 8, 0)}%`);
        return { name: m.name, m: avg(V.map(best)) };
      }).sort((a, c) => c.m - a.m);
      tops.push(`${LEVELS[lv].name.padEnd(13)} food+${key.padEnd(14)} top 3: ${rows.slice(0, 3).map((r) => `${r.name} ${f(r.m)}`).join(", ")} | worst: ${rows[rows.length - 1].name} ${f(rows[rows.length - 1].m)}`);
    }
  console.log("\n== ranking per level and senses");
  for (const t of tops) console.log("  " + t);
}

if (isMainThread) {
  const seeds = opt("seeds", 5);
  const js: Job[] = [];
  for (let level = 0; level < LEVELS.length; level++) for (const build of BUILDS[level]) for (let mix = 0; mix < MIXES.length; mix++) for (let seed = 1; seed <= seeds; seed++) js.push({ level, build, mix, seed });
  const t0 = performance.now(), threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  mkdirSync("proto/out", { recursive: true });
  writeFileSync("proto/out/tune-sliders.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

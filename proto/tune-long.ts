// Rey 2026-10-30 (c): can evolution learn to use the terrain if it gets more time? Builds with and without the
// See terrain card (+ its moves) on the terrain map, 300 generations instead of 60. Every 25 generations the
// current champion plays a test map and we count how it uses the terrain.
//   node proto/tune-long.ts [--gens=300] [--seeds=5] [--workers=N]
import { Evolver, World, SPECIES, DEFAULT_SETTINGS, EXPERIMENT, POP, type Sense } from "./game/sim.ts";
import { stageLevel } from "./game/runner.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism, setPriority, constants } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
EXPERIMENT.terrain = ["river", "farm", "zone"];
EXPERIMENT.terrainMoves = true;
const GENS = Number(opt("gens", "300")), EVERY_USE = 25;
// each species' usual sense for the stage (none where it already starts with it or none helps)
const BASE: Record<string, Sense[][]> = { grazer: [[], ["poison"], ["hunter"]], sprinter: [[], ["poison"], []], scavenger: [[], [], ["hunter"]] };
interface Job { sp: number; stage: number; terrain: boolean; seed: number }
interface Use { gen: number; farm: number; zone: number; water: number; moves: number }
interface Result extends Job { hist: number[]; use: Use[] }

function useOf(ev: Evolver): Use {
  const g = ev.pop[0]; // best of the last generation (kept unchanged as the first parent)
  const w = new World(ev.lv, false, ev.build, ev.layers, Array.from({ length: POP }, () => g), 101, ev.sp) as unknown as { done: boolean; step(): void; alive: boolean[]; act: number[]; px: number[]; py: number[] };
  const t = ev.lv.terrain!;
  const inC = (c: { x: number; y: number; r: number } | null, x: number, y: number) => { if (!c) return false; const dx = ((x - c.x + 600) % 400) - 200, dy = ((y - c.y + 600) % 400) - 200; return dx * dx + dy * dy < c.r * c.r; };
  let n = 0, farm = 0, zone = 0, water = 0, moves = 0;
  while (!w.done) {
    w.step();
    for (let i = 0; i < POP; i++) if (w.alive[i]) {
      n++;
      if (inC(t.farm, w.px[i], w.py[i])) farm++;
      if (inC(t.zone, w.px[i], w.py[i])) zone++;
      if ((w as unknown as { wet(x: number, y: number): boolean }).wet(w.px[i], w.py[i])) water++;
      if (w.act[i] >= 7) moves++;
    }
  }
  return { gen: ev.gen, farm: farm / n, zone: zone / n, water: water / n, moves: moves / n };
}
function run(j: Job): Result {
  const sp = SPECIES[j.sp];
  const order: Sense[] = ["poison", "taste", "hunter", "energy", "terrain", "neighbour"];
  const want = [...sp.start, ...BASE[sp.id][j.stage], ...(j.terrain ? (["terrain"] as Sense[]) : [])];
  const build = order.filter((s) => want.includes(s));
  const ev = new Evolver(stageLevel(j.stage, "calm"), build, [6], j.seed, { ...DEFAULT_SETTINGS, weights: { eat: 1, avoid: 1, live: 0 } }, sp);
  const use: Use[] = [];
  while (ev.gen < GENS) { ev.step(); if (ev.gen % EVERY_USE === 0) use.push(useOf(ev)); }
  return { ...j, hist: ev.hist, use };
}

if (isMainThread) {
  const seeds = Number(opt("seeds", "5")), threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal priority */ }
  const js: Job[] = [];
  for (let sp = 0; sp < 3; sp++) for (const stage of [1, 2]) for (const terrain of [false, true]) for (let seed = 1; seed <= seeds; seed++) js.push({ sp, stage, terrain, seed });
  console.error(`${js.length} runs of ${GENS} generations on ${threads} threads`);
  const t0 = performance.now(), res: Result[] = new Array(js.length);
  let next = 0, done = 0;
  await new Promise<void>((ok, bad) => {
    for (let w = 0; w < Math.min(threads, js.length); w++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < js.length) { mine = next++; wk.postMessage(js[mine]); } else wk.terminate(); };
      wk.on("message", (r: Result) => { res[mine] = r; done++; process.stderr.write(`\r  ${done} of ${js.length} runs, ${((performance.now() - t0) / 60000).toFixed(1)} min${done === js.length ? "\n" : ""}`); if (done === js.length) ok(); feed(); });
      wk.on("error", bad);
      feed();
    }
  });
  mkdirSync("proto/out/long", { recursive: true });
  writeFileSync("proto/out/long/tune-long.json", JSON.stringify(res));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const at = (h: number[], g: number) => avg(h.slice(Math.max(0, g / 5 - 4), g / 5)); // mean of the 4 checks up to generation g
  const marks = [60, 150, GENS].filter((g, i, a) => g <= GENS && a.indexOf(g) === i);
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  console.log(`${GENS} generations, terrain map (river, farm, zone) for all; "+terrain" = See terrain card with its 3 moves. Score = goal vs bot (avg of 4 checks). Use = share of the champion's time on a test map.`);
  for (let sp = 0; sp < 3; sp++) for (const stage of [1, 2]) {
    const A = res.filter((r) => r.sp === sp && r.stage === stage && !r.terrain).sort((a, b) => a.seed - b.seed);
    const B = res.filter((r) => r.sp === sp && r.stage === stage && r.terrain).sort((a, b) => a.seed - b.seed);
    console.log(`\n${SPECIES[sp].name}, ${stage === 1 ? "Poison patch" : "Hunted"} (base: ${[...SPECIES[sp].start, ...BASE[SPECIES[sp].id][stage]].join("+") || "no sense"})`);
    for (const g of marks) {
      const d = B.map((r, i) => at(r.hist, g) - at(A[i].hist, g)), m = margin(d, 0.05);
      const u = (R: Result[], k: keyof Use) => pct(avg(R.map((r) => r.use.find((x) => x.gen === Math.floor(g / EVERY_USE) * EVERY_USE)?.[k] as number)));
      console.log(`  gen ${String(g).padStart(3)}: score ${avg(A.map((r) => at(r.hist, g))).toFixed(2)} -> +terrain ${avg(B.map((r) => at(r.hist, g))).toFixed(2)} (diff ${(avg(d) >= 0 ? "+" : "") + avg(d).toFixed(3)} ±${m.toFixed(3)}${Math.abs(avg(d)) > m ? " *" : ""}) | +terrain use: moves ${u(B, "moves")}, farm ${u(B, "farm")} (without card ${u(A, "farm")}), zone ${u(B, "zone")} (${u(A, "zone")}), water ${u(B, "water")} (${u(A, "water")})`);
    }
  }
  console.log(`\ndone in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
} else {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(run(j)));
}

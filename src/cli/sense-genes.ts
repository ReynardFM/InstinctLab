// Rey 2026-10-31: can creatures evolve their own senses instead of being handed them? With rules.senseGenes each
// optional sense (2nd food, neighbour, poison, hunter) is switched on by a gene; founders start with all off and
// mutation can switch them on. The world has poison (30%) and 4 chasing hunters, so poison and hunter senses
// can pay. Compared with today's lab (every sense handed out), free senses, and senses that cost energy.
//   node src/cli/sense-genes.ts [--gens=130] [--seeds=1-14] [--workers=N] [--cost=0.0002] [--eye=4|8] [--out=name]
// --eye: the raw all-around eye (rules.eye) instead of the "nearest X" senses; its genes switch on the purple,
// creature and hunter channels (gene 0 does nothing: a control). Green (all pellets) is always on.
import { createWorld, runGenerations, DEFAULT_RULES, type Rules } from "../engine/world.ts";
import { SENSE_GENES } from "../engine/genes.ts";
import { margin } from "./stats.ts";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism, setPriority, constants } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const GENS = Number(opt("gens", "130")), COST = Number(opt("cost", "0.0002"));
const [s0, s1] = opt("seeds", "1-14").split("-").map(Number);
const EYE = Number(opt("eye", "0")), OUT = opt("out", EYE ? `eye${EYE}` : "results");
const SENSES = EYE ? ["(control)", "eye creature", "eye purple", "eye hunter"] : ["2nd food", "neighbour", "poison", "hunter"];
const WORLD: Partial<Rules> = { poison: 0.3, hunters: 4, senseFood2: 1, senseCreature: 1, eye: EYE };
const CONDS: [string, Partial<Rules>][] = [
  ["handed out (today)", { senseGenes: 0 }],
  ["evolved, free", { senseGenes: 1, senseCost: 0 }],
  [`evolved, cost ${COST}/tick`, { senseGenes: 1, senseCost: COST }],
];
const MARKS = [10, 30, 60, 100, GENS].filter((g, i, a) => g <= GENS && a.indexOf(g) === i);
interface Job { cond: number; seed: number }
interface Result extends Job { food: number; caught: number; poison: number; adopt: number[][] } // adopt[mark][sense] = share switched on

function run(j: Job): Result {
  const rules = { ...DEFAULT_RULES, ...WORLD, ...CONDS[j.cond][1] } as Rules;
  const w = createWorld(j.seed, rules);
  const adopt: number[][] = [];
  for (let g = 1; g <= GENS; g++) {
    runGenerations(w, 1);
    if (MARKS.includes(g)) adopt.push(Array.from({ length: SENSE_GENES }, (_, s) => rules.senseGenes ? w.creatures.filter((c) => c.g[c.g.length - SENSE_GENES + s] > 0).length / w.creatures.length : 1));
  }
  const last = (h: number[]) => { const x = h.slice(-10); return x.reduce((a, b) => a + b, 0) / x.length; };
  return { ...j, food: last(w.avgHist), caught: last(w.caughtHist), poison: last(w.poisonHist), adopt };
}

if (isMainThread) {
  const threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal priority */ }
  const js: Job[] = [];
  for (let cond = 0; cond < CONDS.length; cond++) for (let seed = s0; seed <= (s1 ?? s0); seed++) js.push({ cond, seed });
  console.error(`${js.length} runs of ${GENS} generations on ${threads} of ${availableParallelism()} threads, low priority`);
  const t0 = performance.now(), res: Result[] = new Array(js.length);
  let next = 0, done = 0;
  await new Promise<void>((ok, bad) => {
    for (let wi = 0; wi < Math.min(threads, js.length); wi++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < js.length) { mine = next++; wk.postMessage(js[mine]); } else wk.terminate(); };
      wk.on("message", (r: Result) => { res[mine] = r; done++; process.stderr.write(`\r  ${done} of ${js.length} runs, ${((performance.now() - t0) / 60000).toFixed(1)} min${done === js.length ? "\n" : ""}`); if (done === js.length) ok(); feed(); });
      wk.on("error", bad);
      feed();
    }
  });
  mkdirSync("proto/out/sense-genes", { recursive: true });
  writeFileSync(`proto/out/sense-genes/${OUT}.json`, JSON.stringify(res));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pct = (x: number) => `${Math.round(100 * x)}%`.padStart(4);
  console.log(`World: poison 30%, 4 chasing hunters, ${EYE ? `raw eye with ${EYE} slices` : "nearest-X senses"}, ${DEFAULT_RULES.pop} creatures, ${GENS} generations, seeds ${s0}-${s1 ?? s0}. Last 10 generations: food per map, share caught, poison per creature.`);
  const base = res.filter((r) => r.cond === 0).sort((a, b) => a.seed - b.seed);
  for (let c = 0; c < CONDS.length; c++) {
    const R = res.filter((r) => r.cond === c).sort((a, b) => a.seed - b.seed);
    const d = R.map((r, i) => r.food - base[i].food), m = margin(d, 0.05);
    console.log(`\n${CONDS[c][0]}: food ${avg(R.map((r) => r.food)).toFixed(1)}${c ? ` (vs handed out ${(avg(d) >= 0 ? "+" : "") + avg(d).toFixed(1)} ±${m.toFixed(1)}${Math.abs(avg(d)) > m ? " *" : ""})` : ""} | caught ${pct(avg(R.map((r) => r.caught)))} | poison ${avg(R.map((r) => r.poison)).toFixed(2)}`);
    if (c) {
      console.log(`  share of creatures with each sense switched on (average over seeds; in how many seeds most have it):`);
      console.log(`  ${"gen".padEnd(5)}${SENSES.map((s) => s.padEnd(18)).join("")}`);
      MARKS.forEach((g, mi) => console.log(`  ${String(g).padEnd(5)}${SENSES.map((_, s) => `${pct(avg(R.map((r) => r.adopt[mi][s])))} (${R.filter((r) => r.adopt[mi][s] > 0.5).length}/${R.length})`.padEnd(18)).join("")}`));
    }
  }
  console.log(`\ndone in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
} else {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(run(j)));
}

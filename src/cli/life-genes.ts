// Rey 2026-11-01: life mode with the raw eye. Can senses evolve with no generations at all? Ecosystem from
// zero (ecoWarmup 0: random founders, all sense genes off), split births, 4 evolving hunters from the first
// tick, poison 30%, eye with 4 slices (genes 0 control, 1 creature, 2 purple, 3 hunter). Handed out vs
// evolved with a cost. Births since the founder ("depth") is the yardstick against generations mode
// (130 generations = depth 130; 130 gens x 3 maps x 1500 ticks = 585,000 ticks there).
//   node src/cli/life-genes.ts [--ticks=200000] [--seeds=1-14] [--workers=N] [--cost=0.0002] [--out=name] [--anyRule=value]
// Raw results: proto/out/life-genes/<out>.json. The summary is short on purpose (token rules).
import { createWorld, runTicks, DEFAULT_RULES, type Rules, type World } from "../engine/world.ts";
import { SENSE_GENES } from "../engine/genes.ts";
import { ECO_BASE } from "./eco-lab.ts";
import { ecoResultOf } from "./job.ts";
import { ecoMetrics, WORKS_QUIET, type EcoMetrics } from "./eco-metrics.ts";
import { margin } from "./stats.ts";
import { baseShare } from "../engine/plants.ts";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism, setPriority, constants } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const TICKS = Number(opt("ticks", "200000")), COST = Number(opt("cost", "0.0002"));
// --seeds=1-14 (a range) or --seeds=13,9,14 (a picked list; Rey 2026-11-13: "can we pick the seed?")
const SEEDS_ARG = opt("seeds", "1-14");
const SEEDS: number[] = SEEDS_ARG.includes(",") ? SEEDS_ARG.split(",").map(Number)
  : (() => { const [a, b] = SEEDS_ARG.split("-").map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); })();
const [s0, s1] = [SEEDS[0], SEEDS[SEEDS.length - 1]];
const OUT = opt("out", "eye4");
// --conds=0 runs only "senses handed out" (Rey 2026-11-24: an overnight with many arms; half the runs). Default: both conditions.
const CONDS_ON = opt("conds", "0,1").split(",").map(Number);
const SENSES = ["control", "creature", "purple", "hunter"];
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v![0]])) as Partial<Rules>;
// senseFood2 / senseCreature only shape the hunters' inputs here (prey use the eye)
const WORLD: Partial<Rules> = { ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1 };
// any other --rule=value overrides that rule in both conditions (e.g. --poisonDose=0)
const OWN = new Set(["ticks", "seeds", "workers", "cost", "out", "conds"]);
const EXTRA: Partial<Rules> = {};
for (const a of process.argv.slice(2)) {
  const m = /^--(\w+)=(.+)$/.exec(a);
  if (!m || OWN.has(m[1])) continue;
  if (!(m[1] in DEFAULT_RULES)) throw new Error(`unknown rule ${m[1]}`);
  (EXTRA as Record<string, number>)[m[1]] = Number(m[2]);
}
Object.assign(WORLD, EXTRA);
const CONDS: [string, Partial<Rules>][] = [
  ["handed out", { senseGenes: 0 }],
  [`evolved, cost ${COST}/tick`, { senseGenes: 1, senseCost: COST }],
];
// With seasons (rules.season) the marks are the end of every season (a quarter of the year), so resistance and pick can be read per season.
const QUARTER = (WORLD.season ?? 0) > 0 ? Math.round((WORLD.season as number) / 4) : 0;
// With a poison ramp (rules.poisonRamp) the marks are every 20k ticks, so resistance can be read as the poison rises.
const RAMPED = (WORLD.poisonRamp ?? 0) > 0;
const MARKS = (QUARTER > 0 ? Array.from({ length: Math.floor(TICKS / QUARTER) }, (_, i) => (i + 1) * QUARTER).concat(TICKS)
  : RAMPED ? Array.from({ length: Math.floor(TICKS / 20000) }, (_, i) => (i + 1) * 20000).concat(TICKS)
  : [10000, 30000, 60000, 100000, 200000, 400000, 600000, TICKS]).filter((t, i, a) => t <= TICKS && a.indexOf(t) === i);
interface Job { cond: number; seed: number }
interface Mark { rounds: number; prey: number; hunters: number; hResist: number; pResist: number; hLow: number; hHigh: number; // hunters with resistance < 0.2 / > 0.6
  hDrift: number; depth: number; maxDepth: number; adopt: number[];
  sick: number[] } // running totals for pick per time window: [catches, sick catches, sum of sampled sick share, samples]
interface Result extends Job { marks: Mark[]; m: EcoMetrics; caughtPer1k: number; restarts: number; remainsPer1k: number; dose: World["eco"]["dose"] }

const mark = (w: World, genes: boolean): Mark => {
  const cs = w.creatures, n = Math.max(1, cs.length);
  return {
    hLow: w.hunters.filter((h) => h.resist < 0.2).length, hHigh: w.hunters.filter((h) => h.resist > 0.6).length,
    rounds: w.eco.rounds.length, // die-out rounds so far (to see when a ramp breaks the world)
    pResist: cs.reduce((a, c) => a + c.resist, 0) / n,
    prey: cs.length, hunters: w.hunters.length, hResist: w.hunters.length ? w.hunters.reduce((a, h) => a + h.resist, 0) / w.hunters.length : 0,
    // learned change: mean |working - inborn| weight per hunter (0 without learning)
    hDrift: w.hunters.length ? w.hunters.reduce((a, h) => { const b = h.brain!; let d = 0; for (let k = 0; k < b.w.length; k++) d += Math.abs(b.w[k] - b.g[k]); return a + d / b.w.length; }, 0) / w.hunters.length : 0,
    depth: cs.reduce((a, c) => a + c.depth, 0) / n, maxDepth: cs.reduce((a, c) => Math.max(a, c.depth), 0),
    adopt: Array.from({ length: SENSE_GENES }, (_, s) => genes ? cs.filter((c) => c.g[c.g.length - SENSE_GENES + s] > 0).length / n : 1),
    sick: [w.eco.sick.caught, w.eco.sick.caughtSick, w.eco.sick.sickShare, w.eco.sick.samples],
  };
};

function run(j: Job): Result {
  const rules = { ...DEFAULT_RULES, ...WORLD, ...CONDS[j.cond][1] } as Rules;
  const w = createWorld(j.seed, rules);
  const marks: Mark[] = [];
  let t = 0;
  for (const m of MARKS) { runTicks(w, m - t); t = m; marks.push(mark(w, rules.senseGenes > 0)); }
  const e = ecoResultOf(w, false);
  return { ...j, marks, m: ecoMetrics(e), caughtPer1k: (1000 * w.eco.caught) / TICKS, restarts: w.eco.rescues, remainsPer1k: (1000 * w.eco.remainsEaten) / TICKS, dose: w.eco.dose };
}

if (isMainThread) {
  const threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  // Standing rule: low priority (Rey plays games meanwhile). LAB_PRIORITY=normal (set by the night batch, Rey 2026-11-11) keeps normal priority.
  const NORMAL = process.env.LAB_PRIORITY === "normal";
  if (!NORMAL) try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal priority */ }
  const js: Job[] = [];
  for (let cond = 0; cond < CONDS.length; cond++) if (CONDS_ON.includes(cond)) for (const seed of SEEDS) js.push({ cond, seed });
  console.error(`${js.length} runs of ${TICKS} ticks on ${threads} of ${availableParallelism()} threads, ${NORMAL ? "normal" : "low"} priority`);
  const t0 = performance.now(), res: Result[] = new Array(js.length);
  let next = 0, done = 0;
  await new Promise<void>((ok, bad) => {
    for (let wi = 0; wi < Math.min(threads, js.length); wi++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < js.length) { mine = next++; wk.postMessage(js[mine]); } else wk.terminate(); };
      wk.on("message", (r: Result) => {
        res[mine] = r; done++;
        console.error(`  run ${done} of ${js.length} done (${((performance.now() - t0) / 60000).toFixed(0)} min)`); // progress (Rey 2026-11-11)
        if (done === js.length) ok(); feed();
      });
      wk.on("error", bad);
      feed();
    }
  });
  mkdirSync("proto/out/life-genes", { recursive: true });
  writeFileSync(`proto/out/life-genes/${OUT}.json`, JSON.stringify(res));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  const f1 = (x: number) => x.toFixed(1);
  console.log(`Life mode: eye4, poison 30%, 4 brain hunters (${WORLD.hunterEye ? `hunter eye ${WORLD.hunterEye}` : "old hunter senses"}${WORLD.eyeMotion ? ", motion channels" : ""}) from tick 0, ecosystem from zero, split births, ${TICKS} ticks, seeds ${s0}-${s1 ?? s0}${Object.keys(EXTRA).length ? `, ${JSON.stringify(EXTRA)}` : ""}.`);
  const B = res.filter((r) => r.cond === 0).sort((a, b) => a.seed - b.seed);
  for (let c = 0; c < CONDS.length; c++) {
    const R = res.filter((r) => r.cond === c).sort((a, b) => a.seed - b.seed);
    if (!R.length) continue; // --conds: this condition was not run
    const d = R.map((r, i) => r.m.prey - B[i].m.prey), mg = margin(d, 0.05);
    console.log(`\n${CONDS[c][0]}: prey ${f1(avg(R.map((r) => r.m.prey)))}${c ? ` (vs handed out ${(avg(d) >= 0 ? "+" : "") + f1(avg(d))} ±${f1(mg)}${Math.abs(avg(d)) > mg ? " *" : ""})` : ""}, hunters ${f1(avg(R.map((r) => r.m.hunters)))}, caught/1k ticks ${f1(avg(R.map((r) => r.caughtPer1k)))}, poison/prey/1k ${f1(avg(R.map((r) => r.m.poison)))}, pick ${avg(R.map((r) => r.m.pick)).toFixed(2)} (sick share of catches / sick share of prey; below 1 = hunters avoid sick prey)`);
    console.log(`  ${WORLD.remains ? `remains eaten/1k ticks ${f1(avg(R.map((r) => r.remainsPer1k)))}; ` : ""}die-outs per run: prey ${f1(avg(R.map((r) => r.m.preyDieOuts)))} (max ${Math.max(...R.map((r) => r.m.preyDieOuts))}), hunters ${f1(avg(R.map((r) => r.m.hunterDieOuts)))}; seeds with >10 prey die-outs ${R.filter((r) => r.m.preyDieOuts > 10).length}/${R.length}`);
    console.log(`  ${"tick".padEnd(8)}${"depth (max)".padEnd(14)}${c ? SENSES.map((s) => s.padEnd(13)).join("") : ""}`);
    MARKS.forEach((t, mi) => {
      const M = R.map((r) => r.marks[mi]);
      const genes = c ? SENSES.map((_, s) => `${pct(avg(M.map((m) => m.adopt[s])))} (${M.filter((m) => m.adopt[s] > 0.5).length})`.padEnd(13)).join("") : "";
      console.log(`  ${String(t).padEnd(8)}${`${f1(avg(M.map((m) => m.depth)))} (${Math.max(...M.map((m) => m.maxDepth))})`.padEnd(14)}${genes}`);
    });
    // where the hunters' poison comes from (prey level bins) and how harmed hunters are when they die
    const sum = (k: "n" | "taken") => [0, 1, 2, 3, 4, 5].map((b) => R.reduce((a, r) => a + r.dose[k][b], 0));
    const n = sum("n"), tk = sum("taken"), nT = n.reduce((a, b) => a + b, 0), tT = tk.reduce((a, b) => a + b, 0) || 1;
    const BINS = ["0", "<=.02", "<=.05", "<=.1", "<=.3", ">.3"];
    console.log(`  catches by prey poison level: ${BINS.map((b, i) => `${b} ${pct(n[i] / (nT || 1))}`).join(", ")}`);
    console.log(`  poison taken by prey level:   ${BINS.map((b, i) => `${b} ${pct(tk[i] / tT)}`).join(", ")}; from not-sick prey (<=0.1): ${pct((tk[1] + tk[2] + tk[3]) / tT)}`);
    console.log(`  hunter learned drift |w - g| at ${MARKS.map((t) => t / 1000 + "k").join("/")}: ${MARKS.map((_, mi) => avg(R.map((r) => r.marks[mi].hDrift)).toFixed(3)).join(" / ")}`);
    const dd = R.reduce((a, r) => a + r.dose.deaths, 0) || 1;
    const ds = [0, 1, 2].map((k) => R.reduce((a, r) => a + r.dose.dirSick[k], 0)), dc = [0, 1, 2].map((k) => R.reduce((a, r) => a + r.dose.dirClean[k], 0));
    const sh = (v: number[]) => { const t = v[0] + v[1] + v[2] || 1; return `ahead ${pct(v[0] / t)}, side ${pct(v[1] / t)}, behind ${pct(v[2] / t)} (n ${v[0] + v[1] + v[2]})`; };
    console.log(`  catch direction, sick prey: ${sh(ds)}; clean prey: ${sh(dc)}`);
    // zero point (Rey 2026-11-04): what a hunter that picked at random would score, on the same scale as pick
    const fin = (xs: number[]) => xs.filter(Number.isFinite), f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
    const zk = (k: number) => R.map((r) => (r.dose.zero[2 * k] && r.m.sick > 0 ? r.dose.zero[2 * k + 1] / r.dose.zero[2 * k] / r.m.sick : NaN));
    const [zW, z200, z50, z25, z12] = [0, 2, 1, 3, 4].map(zk), pk = R.map((r) => r.m.pick);
    const below = R.filter((_, i) => Number.isFinite(pk[i]) && Number.isFinite(z200[i]) && pk[i] < z200[i]).length, both = R.filter((_, i) => Number.isFinite(pk[i]) && Number.isFinite(z200[i])).length;
    console.log(`  zero point (random hunter; same scale as pick): whole world ${f2(avg(fin(zW)))}, within 200px ${f2(avg(fin(z200)))} (catches ${R.reduce((a, r) => a + r.dose.zero[4], 0)}), within 50px ${f2(avg(fin(z50)))} (catches ${R.reduce((a, r) => a + r.dose.zero[2], 0)}), within 25px ${f2(avg(fin(z25)))} (catches ${R.reduce((a, r) => a + r.dose.zero[6], 0)}), within 12px ${f2(avg(fin(z12)))} (catches ${R.reduce((a, r) => a + r.dose.zero[8], 0)}); pick ${f2(avg(fin(pk)))}; seeds with pick below own 200px zero: ${below} of ${both}`);
    if (WORLD.hunterBite) {
      const bs = [0, 1].map((k) => R.reduce((x, r) => x + r.dose.biteSick[k], 0)), bc = [0, 1].map((k) => R.reduce((x, r) => x + r.dose.biteClean[k], 0));
      console.log(`  bite: sick prey in reach refused ${pct(bs[1] / (bs[0] + bs[1] || 1))} (n ${bs[0] + bs[1]}), clean refused ${pct(bc[1] / (bc[0] + bc[1] || 1))} (n ${bc[0] + bc[1]})`);
    }
    // pick per time window (Rey 2026-11-09: is pick still falling?): from the running totals at each mark
    const winPick = (r: Result, mi: number) => { const a = r.marks[mi].sick, b = mi ? r.marks[mi - 1].sick : [0, 0, 0, 0]; const c = a[0] - b[0], n = a[3] - b[3], sh = a[2] - b[2]; return c > 0 && n > 0 && sh > 0 ? (a[1] - b[1]) / c / (sh / n) : NaN; };
    if ((WORLD.resistGene ?? 0) > 0 || RAMPED) {
      const at = (fn: (m: Mark) => number) => MARKS.map((_, mi) => f2(avg(R.map((r) => fn(r.marks[mi]))))).join(" / ");
      const B0 = baseShare(createWorld(1, { ...DEFAULT_RULES, ...WORLD } as Rules)); // the ramp starts at the normal world's share (0.23), as plants.ts does (FIX 2026-11-20: the print started at rules.poison 0.30; the engine was right)
      if (RAMPED) console.log(`  ramp: poison share at ${MARKS.map((t) => t / 1000 + "k").join(" / ")}: ${MARKS.map((t) => f2(B0 + ((WORLD.poisonPeak ?? 0.9) - B0) * Math.min(1, t / (WORLD.poisonRamp as number)))).join(" / ")} | prey ${at((m) => m.prey)} | die-out rounds so far ${at((m) => m.rounds)}`);
      console.log(`  hunters by resistance at the end (low < 0.2 / high > 0.6, summed over seeds): ${R.reduce((a, r) => a + r.marks[r.marks.length - 1].hLow, 0)} / ${R.reduce((a, r) => a + r.marks[r.marks.length - 1].hHigh, 0)} of ${R.reduce((a, r) => a + r.marks[r.marks.length - 1].hunters, 0)}`);
      console.log(`  resistance at ${MARKS.map((t) => t / 1000 + "k").join(" / ")}: prey ${at((m) => m.pResist)}; hunters ${at((m) => m.hResist)}`);
    }
    console.log(`  pick by window (ending ${MARKS.map((t) => t / 1000 + "k").join(" / ")}): ${MARKS.map((_, mi) => f2(avg(fin(R.map((r) => winPick(r, mi)))))).join(" / ")}`);
    console.log(`  works (no die-out in last ${WORKS_QUIET / 1000}k, each side cycled >= 1 inside the running round): ${R.filter((r) => r.m.works).length} of ${R.length} seeds; prey cycles ${f1(avg(R.map((r) => r.m.preyCyclesNow)))}, hunter cycles ${f1(avg(R.map((r) => r.m.hunterCyclesNow)))}, ticks since last die-out ${Math.round(avg(R.map((r) => r.m.quiet)))}`);
    console.log(`  hunter deaths ${dd}: hunger factor at death ${(R.reduce((a, r) => a + r.dose.deathHarm, 0) / dd).toFixed(2)}x, harm > 0.5 in ${pct(R.reduce((a, r) => a + r.dose.deathsHarmed, 0) / dd)}`);
    if (c) {
      const L = R.map((r) => r.marks.at(-1)!);
      const beat = (s: number) => L.filter((m) => m.adopt[s] - m.adopt[0] > 0.2).length;
      console.log(`  done check (gene beats control by >20 points at the end): hunter ${beat(3)}/${R.length}, purple ${beat(2)}/${R.length}, creature ${beat(1)}/${R.length}`);
    }
  }
  console.log(`\ndone in ${((performance.now() - t0) / 60000).toFixed(1)} min. Raw: proto/out/life-genes/${OUT}.json`);
} else {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(run(j)));
}

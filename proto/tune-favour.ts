// Rey 2026-10-30 (a): "evolution is blind, you are not". Does backing a family with foresight change results, or
// does evolution re-sort everything anyway? Poison patch (60 generations) then Hunted (60), population carried.
// Every 10 generations on Poison patch a "player" backs one of the 3 biggest families (half the parents come
// from it for the next 10 generations), judging each family by its best brain:
//   auto   = never backs anyone (today's game)
//   oracle = foresight: the family whose best brain does best on Hunted (what a player sees coming)
//   greedy = the family doing best on Poison patch right now
//   random = any of the three
// early = See hunter owned from the start (bought ahead); else it is added at Hunted.
// --islands=3: the population breeds as 3 separate islands (each island = a family, always 3 alive); "plain" =
// no islands and no backing, today's game, to see what islands themselves cost.
//   node proto/tune-favour.ts [--seeds=8] [--workers=N] [--islands=3]
import { Evolver, SPECIES, DEFAULT_SETTINGS, heldOut, goalValue, expandGenome, makeBody, type Sense } from "./game/sim.ts";
import { stageLevel, stageScore, BUDGET } from "./game/runner.ts";
import { createRng } from "../src/engine/rng.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism, setPriority, constants } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
type Policy = "auto" | "oracle" | "greedy" | "random" | "plain";
const ISLANDS = Number(opt("islands", "0"));
const POLICIES: Policy[] = ["auto", "oracle", "greedy", "random", ...(ISLANDS ? (["plain"] as Policy[]) : [])];
const SP = [0, 2]; // grazer, scavenger (both need See hunter on Hunted)
const S1: Record<string, Sense[]> = { grazer: ["poison"], scavenger: [] };
interface Job { sp: number; policy: Policy; early: boolean; seed: number }
interface Result extends Job { s1: number; s2: number; s2early: number; picks: number[]; spread: number[]; disagree: number }
const order: Sense[] = ["poison", "taste", "hunter", "energy", "neighbour"];
const sorted = (xs: Sense[]) => order.filter((s) => xs.includes(s));

function run(j: Job): Result {
  const sp = SPECIES[j.sp], set = { ...DEFAULT_SETTINGS, weights: { eat: 1, avoid: 1, live: 0 } };
  const b1 = sorted([...sp.start, ...S1[sp.id], ...(j.early ? (["hunter"] as Sense[]) : [])]), b2 = sorted([...b1, "hunter"]);
  const lv1 = stageLevel(1, "calm"), lv2 = stageLevel(2, "calm"), body = makeBody(sp);
  const ev = new Evolver(lv1, b1, [6], j.seed, set, sp);
  if (ISLANDS && j.policy !== "plain") ev.islands = ISLANDS;
  const r = createRng(j.seed * 97 + 5), picks: number[] = [], spread: number[] = [];
  let disagree = 0;
  while (ev.gen < BUDGET) {
    if (j.policy !== "auto" && j.policy !== "plain" && ev.gen > 0 && ev.gen % 10 === 0) {
      const size = new Map<number, number>();
      for (const f of ev.fam) size.set(f, (size.get(f) ?? 0) + 1);
      const top = [...size].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([f]) => f);
      const rep = (f: number) => ev.pop[ev.fam.indexOf(f)]; // first in pop order = the family's best parent
      const value = (f: number) => j.policy === "oracle"
        ? goalValue(heldOut(lv2, false, b2, [6], expandGenome(rep(f), b1, b2, [6]), sp, body), sp.goal)
        : goalValue(heldOut(lv1, false, b1, [6], rep(f), sp, body), sp.goal);
      const pick = j.policy === "random" ? top[Math.floor(r.next() * top.length)] : top.reduce((a, b) => (value(b) > value(a) ? b : a));
      if (j.policy === "oracle") { // how different are the families on what's coming, and would greedy have picked another?
        const v2 = top.map((f) => goalValue(heldOut(lv2, false, b2, [6], expandGenome(rep(f), b1, b2, [6]), sp, body), sp.goal));
        const v1 = top.map((f) => goalValue(heldOut(lv1, false, b1, [6], rep(f), sp, body), sp.goal));
        spread.push(Math.max(...v2) - Math.min(...v2));
        if (v1.indexOf(Math.max(...v1)) !== v2.indexOf(Math.max(...v2))) disagree++;
      }
      ev.favour = { fam: pick, share: 0.5 };
      picks.push(pick);
    }
    ev.step();
  }
  const s1 = stageScore(ev.hist);
  ev.favour = null;
  ev.nextStage(lv2, b2);
  const from = ev.hist.length;
  while (ev.gen < 2 * BUDGET) ev.step();
  const h2 = ev.hist.slice(from);
  return { ...j, s1, s2: stageScore(h2), s2early: (h2[0] + h2[1] + h2[2] + h2[3]) / 4, picks, spread, disagree }; // early = first 20 generations of Hunted
}

if (isMainThread) {
  const seeds = Number(opt("seeds", "8")), threads = Number(opt("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal priority */ }
  const js: Job[] = [];
  for (const sp of SP) for (const early of [true, false]) for (const policy of POLICIES) for (let seed = 1; seed <= seeds; seed++) js.push({ sp, policy, early, seed });
  console.error(`${js.length} runs (Poison patch then Hunted) on ${threads} threads`);
  const t0 = performance.now(), res: Result[] = new Array(js.length);
  let next = 0, done = 0;
  await new Promise<void>((ok, bad) => {
    for (let w = 0; w < Math.min(threads, js.length); w++) {
      const wk = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      let mine = -1;
      const feed = () => { if (next < js.length) { mine = next++; wk.postMessage(js[mine]); } else wk.terminate(); };
      wk.on("message", (x: Result) => { res[mine] = x; done++; process.stderr.write(`\r  ${done} of ${js.length} runs, ${((performance.now() - t0) / 60000).toFixed(1)} min${done === js.length ? "\n" : ""}`); if (done === js.length) ok(); feed(); });
      wk.on("error", bad);
      feed();
    }
  });
  const OUT = ISLANDS ? "proto/out/favour-islands" : "proto/out/favour";
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/tune-favour.json`, JSON.stringify(res));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
  console.log(`Backing a family on Poison patch (half the parents for 10 generations, 5 times) vs never (auto); paired by seed, * = probably real.`);
  for (const sp of SP) for (const early of [true, false]) {
    console.log(`\n${SPECIES[sp].name}, See hunter ${early ? "owned from the start" : "added at Hunted"}`);
    const A = res.filter((x) => x.sp === sp && x.early === early && x.policy === "auto").sort((a, b) => a.seed - b.seed);
    console.log(`  auto     Poison patch ${avg(A.map((x) => x.s1)).toFixed(3)} | Hunted ${avg(A.map((x) => x.s2)).toFixed(3)}${ISLANDS ? " (islands, nobody backed)" : ""}`);
    const O = res.filter((x) => x.sp === sp && x.early === early && x.policy === "oracle");
    console.log(`  families differ on Hunted by ${avg(O.flatMap((x) => x.spread)).toFixed(3)} (best minus worst of the 3, average); foresight and greedy disagree in ${O.reduce((a, x) => a + x.disagree, 0)} of ${O.length * 5} choices`);
    for (const p of POLICIES.slice(1)) {
      const P = res.filter((x) => x.sp === sp && x.early === early && x.policy === p).sort((a, b) => a.seed - b.seed);
      const d1 = P.map((x, i) => x.s1 - A[i].s1), d2 = P.map((x, i) => x.s2 - A[i].s2), d3 = P.map((x, i) => x.s2early - A[i].s2early), m1 = margin(d1, 0.05), m2 = margin(d2, 0.05), m3 = margin(d3, 0.05);
      console.log(`  ${p.padEnd(8)} Poison patch ${f(avg(d1))} ±${m1.toFixed(3)}${Math.abs(avg(d1)) > m1 ? " *" : "  "} | Hunted, first 20 gens ${f(avg(d3))} ±${m3.toFixed(3)}${Math.abs(avg(d3)) > m3 ? " *" : "  "} | Hunted, end ${f(avg(d2))} ±${m2.toFixed(3)}${Math.abs(avg(d2)) > m2 ? " *" : ""}`);
    }
  }
  console.log(`\ndone in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
} else {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(run(j)));
}

// T4 (2026-10-30): pass bars from the data instead of by hand, per species x stage x event.
// Rule "top 25%": the bar is the mean score of the build at the 25% mark, so about a quarter of all builds
// pass on average. Shown next to it: rule "half gap" (no card + half the gap to the best build) and today's bar.
//   node proto/tune-v2-bars.ts [--dir=proto/out/round2] [--top=0.25]
import { readdirSync, readFileSync } from "node:fs";
import { SPECIES, EVENTS, type Card, type EventId } from "./game/sim.ts";
import { STAGES } from "./game/runner.ts";
import type { Result } from "./tune-v2.ts";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const DIR = arg("dir", "proto/out"), TOP = Number(arg("top", "0.25"));
const A: Result[] = readdirSync(DIR).filter((f) => f.startsWith("tune-v2-A") && f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")));
const BARS: Record<string, number[]> = { grazer: [0.6, 0.35, 0.45], sprinter: [0.6, 0.6, 0.4], scavenger: [0.6, 1.1, 0.45] };
const KEY: Record<string, Card[][]> = { grazer: [[], ["poison"], ["hunter"]], sprinter: [[], ["poison"], ["poison"]], scavenger: [[], ["taste"], ["hunter"]] }; // the stage's right sense (from earlier tests)
const EVS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const key = (c: Card[]) => (c.length ? [...c].sort().join("+") : "(none)");
const f = (x: number) => x.toFixed(2);
const out: Record<string, Record<string, number>> = {};
console.log(`bars from ${DIR}: rule top ${TOP * 100}% (bar = mean of the build at the ${TOP * 100}% mark) vs half gap (no card + half the gap to the best) vs today`);
console.log(`pass = builds with >= 4 of 5 seeds at or above the bar (raced pairs with 2 seeds count as not passing); key = the stage's right sense alone`);
for (let si = 0; si < SPECIES.length; si++) {
  const sp = SPECIES[si], R = A.filter((r) => r.sp === si);
  if (!R.length) continue;
  out[sp.id] = {};
  console.log(`\n${sp.name}`);
  for (const stage of [1, 2]) for (const event of EVS) {
    const S = R.filter((r) => r.stage === stage && r.event === event);
    const by = new Map<string, number[]>();
    for (const r of S) by.set(key(r.cards), [...(by.get(key(r.cards)) ?? []), r.score]);
    const ms = [...by].map(([k, xs]) => ({ k, m: avg(xs), xs })).sort((a, b) => b.m - a.m);
    const top = ms[Math.min(ms.length - 1, Math.floor(TOP * ms.length))].m;
    const none = by.get("(none)")!, best = ms[0].m, half = avg(none) + 0.5 * (best - avg(none)), today = BARS[sp.id][stage];
    const pass = (bar: number) => ms.filter((b) => b.xs.length >= 5 && b.xs.filter((x) => x >= bar).length >= 4).length;
    const keyB = key(KEY[sp.id][stage]), keyXs = by.get(keyB) ?? [];
    const keyPass = (bar: number) => `${keyXs.filter((x) => x >= bar).length}/${keyXs.length}`;
    const nonePass = (bar: number) => `${none.filter((x) => x >= bar).length}/${none.length}`;
    out[sp.id][`${stage}|${event}`] = Number(top.toFixed(2));
    console.log(`  ${`${STAGES[stage].name}/${EVENTS[event].name}`.padEnd(26)} top25 ${f(top)} (pass ${pass(top)}/${ms.length}, no card ${nonePass(top)}, key ${keyPass(top)}) | half gap ${f(half)} (pass ${pass(half)}, no card ${nonePass(half)}, key ${keyPass(half)}) | today ${f(today)} (pass ${pass(today)}, no card ${nonePass(today)}) | no card ${f(avg(none))}, best ${f(best)}`);
  }
}
console.log(`\nbars (top ${TOP * 100}%), for the game: ${JSON.stringify(out)}`);

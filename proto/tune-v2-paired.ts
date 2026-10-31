// An experiment vs a base run (2026-10-30): for every species and card, the change in stage score of the builds
// that have the card (a species' start senses count), paired by build, stage, event and seed.
// * = probably real (95%, paired t). Builds the experiment didn't run are skipped.
//   node proto/tune-v2-paired.ts --dir=proto/out/moves1 [--base=proto/out/round2]
import { readdirSync, readFileSync } from "node:fs";
import { SPECIES, EVENTS, CARD_INFO, type Card, type EventId } from "./game/sim.ts";
import { STAGES } from "./game/runner.ts";
import { margin } from "../src/cli/stats.ts";
import type { Result } from "./tune-v2.ts";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const load = (dir: string): Result[] => readdirSync(dir).filter((f) => f.startsWith("tune-v2-A") && f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
const X = load(arg("dir", "proto/out")), B = load(arg("base", "proto/out/round2"));
const id = (r: Result) => [r.sp, [...r.cards].sort().join("+"), r.stage, r.event, r.seed].join("|");
const base = new Map(B.map((r) => [id(r), r.score]));
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
const EVS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
console.log(`${arg("dir", "")} vs ${arg("base", "proto/out/round2")}: change in stage score, paired by seed (* = probably real)`);
for (let si = 0; si < SPECIES.length; si++) {
  const sp = SPECIES[si], R = X.filter((r) => r.sp === si && base.has(id(r)));
  if (!R.length) continue;
  console.log(`\n${sp.name} (${R.length} paired runs)`);
  const has = (r: Result, c: Card) => r.cards.includes(c) || sp.start.includes(c as never);
  const cards = [...new Set(R.flatMap((r) => [...r.cards, ...sp.start]))] as Card[];
  for (const c of [...cards, "(no card)"] as string[]) {
    const S = c === "(no card)" ? R.filter((r) => !r.cards.length) : R.filter((r) => has(r, c as Card));
    if (!S.length) continue;
    const d = S.map((r) => r.score - base.get(id(r))!), m = margin(d, 0.05);
    const per = [1, 2].flatMap((stage) => EVS.map((event) => {
      const e = S.filter((r) => r.stage === stage && r.event === event).map((r) => r.score - base.get(id(r))!);
      const mm = e.length > 1 ? margin(e, 0.05) : Infinity;
      return { label: `${STAGES[stage].name}/${EVENTS[event].name}`, v: avg(e), real: Math.abs(avg(e)) > mm };
    }));
    const up = per.filter((p) => p.real && p.v > 0), dn = per.filter((p) => p.real && p.v < 0);
    console.log(`  ${(CARD_INFO[c as Card]?.name ?? c).padEnd(15)} ${f(avg(d))} ±${m.toFixed(3)}${Math.abs(avg(d)) > m ? " *" : "  "} (n ${d.length}) | real up in ${up.length}/10 ${up.map((p) => `${p.label} ${f(p.v)}`).join(", ")} | real down in ${dn.length}/10 ${dn.map((p) => `${p.label} ${f(p.v)}`).join(", ")}`);
  }
}

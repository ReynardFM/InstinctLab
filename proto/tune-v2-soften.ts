// Call 3a check (Rey 2026-10-30): a body card must soften the stage's threat, not cancel it.
// Per species and stage/event: no card, the body card alone, the stage's key sense alone (Poison patch: See poison,
// Hunted: See hunter). Cancels = the body card alone scores at least as well as the key sense alone.
//   node proto/tune-v2-soften.ts --dir=proto/out/w1 [--base=proto/out/round2]
import { readdirSync, readFileSync } from "node:fs";
import { SPECIES, EVENTS, CARD_INFO, type Card, type EventId } from "./game/sim.ts";
import { STAGES } from "./game/runner.ts";
import type { Result } from "./tune-v2.ts";
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const load = (dir: string): Result[] => readdirSync(dir).filter((f) => f.startsWith("tune-v2-A") && f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
const X = load(arg("dir", "proto/out")), B = load(arg("base", "proto/out/round2"));
const k = (r: Result) => `${r.sp}|${[...r.cards].sort().join("+")}`;
const have = new Set(X.map(k)), A = [...X, ...B.filter((r) => !have.has(k(r)))];
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const EVS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
const mean = (sp: number, cards: Card[], stage: number, ev: EventId) => avg(A.filter((r) => r.sp === sp && r.stage === stage && r.event === ev && [...r.cards].sort().join("+") === [...cards].sort().join("+")).map((r) => r.score));
for (const [card, stage, key] of [["legs", 2, "hunter"], ["stomach", 1, "poison"], ["legs", 1, "poison"], ["stomach", 2, "hunter"]] as [Card, number, Card][]) {
  console.log(`\n${CARD_INFO[card].name} on ${STAGES[stage].name} (key sense ${CARD_INFO[key].name})`);
  for (let sp = 0; sp < SPECIES.length; sp++) {
    if (SPECIES[sp].start.includes(key as never)) { console.log(`  ${SPECIES[sp].name.padEnd(10)} starts with the key sense: skipped`); continue; }
    let cancels = 0;
    const cells = EVS.map((ev) => { const n = mean(sp, [], stage, ev), c = mean(sp, [card], stage, ev), s = mean(sp, [key], stage, ev); if (c >= s) cancels++; return `${EVENTS[ev].name} ${n.toFixed(2)}/${c.toFixed(2)}/${s.toFixed(2)}`; });
    console.log(`  ${SPECIES[sp].name.padEnd(10)} cancels in ${cancels}/5 | none/card/key: ${cells.join(" | ")}`);
  }
}

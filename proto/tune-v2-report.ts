// Analysis of proto/tune-v2.ts results (all proto/out/tune-v2-A*.json and -B*.json found).
//   node proto/tune-v2-report.ts
import { readdirSync, readFileSync } from "node:fs";
import { SPECIES, EVENTS, CARD_INFO, POWERS, type Card, type EventId } from "./game/sim.ts";
import { STAGES } from "./game/runner.ts";
import { margin } from "../src/cli/stats.ts";
import type { Result } from "./tune-v2.ts";

const BARS: Record<string, number[]> = { grazer: [0.6, 0.35, 0.45], sprinter: [0.6, 0.6, 0.4], scavenger: [0.6, 1.1, 0.45] };
const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? "proto/out"; // round 1: --dir=proto/out/round1
const load = (ph: string): Result[] => readdirSync(DIR).filter((f) => f.startsWith(`tune-v2-${ph}`) && f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")));
const A = load("A"), B = load("B");
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const key = (cards: Card[]) => (cards.length ? [...cards].sort().join("+") : "(none)");
const cardName = (c: string) => CARD_INFO[c as Card]?.name ?? (c === "learning" ? "Learning in life" : c); // round 1 had a learning card
const name = (k: string) => (k === "(none)" ? "no card" : k.split("+").map(cardName).join(" + "));
const real = (d: number[]) => d.length > 1 && Math.abs(avg(d)) > margin(d, 0.05);
const EVS: EventId[] = ["calm", "drought", "night", "bloom", "swarm"];
const SE = [1, 2].flatMap((stage) => EVS.map((event) => ({ stage, event, label: `${STAGES[stage].name}/${EVENTS[event].name}` })));

for (let si = 0; si < SPECIES.length; si++) {
  const sp = SPECIES[si], R = A.filter((r) => r.sp === si);
  if (!R.length) continue;
  console.log(`\n################ ${sp.name} (goal ${sp.goal}; starts with ${sp.start.join(", ") || "food only"}; bars ${BARS[sp.id].slice(1).join(" / ")})`);
  const builds = [...new Set(R.map((r) => key(r.cards)))];
  const cards = [...new Set(R.flatMap((r) => r.cards))] as Card[];
  const scores = (k: string, stage: number, event: EventId) => R.filter((r) => key(r.cards) === k && r.stage === stage && r.event === event).sort((a, b) => a.seed - b.seed).map((r) => r.score);
  const topCount = new Map<string, number>(), inTop = new Map<Card, number>();
  // per stage-event: best builds and pass rates
  console.log("\nbest builds per stage/event (mean of 5 seeds; pass = seeds at or above the bar):");
  for (const se of SE) {
    const bar = BARS[sp.id][se.stage];
    const ranked = builds.map((k) => { const xs = scores(k, se.stage, se.event); return { k, m: avg(xs), e: margin(xs, 0.05), pass: xs.filter((x) => x >= bar).length, n: xs.length }; }).sort((a, b) => b.m - a.m);
    const top = ranked.filter((x) => x.m >= ranked[0].m - ranked[0].e).slice(0, 8); // tied with the best
    for (const t of top.slice(0, 3)) topCount.set(t.k, (topCount.get(t.k) ?? 0) + 1);
    for (const c of new Set(top.flatMap((t) => t.k.split("+")))) if (c !== "(none)") inTop.set(c as Card, (inTop.get(c as Card) ?? 0) + 1); // once per stage/event
    const passing = ranked.filter((x) => x.pass >= 4).length;
    console.log(`  ${se.label.padEnd(26)} best ${name(ranked[0].k)} ${f(ranked[0].m)} (${ranked[0].pass}/5) | ${name(ranked[1].k)} ${f(ranked[1].m)} | ${name(ranked[2].k)} ${f(ranked[2].m)} | no card ${f(ranked.find((x) => x.k === "(none)")!.m)} | builds passing >=4/5: ${passing}/${ranked.length} | worst ${name(ranked[ranked.length - 1].k)} ${f(ranked[ranked.length - 1].m)}`);
  }
  // card value
  console.log("\ncard value (score of builds with the card minus without, averaged over the 10 stage/events; 'top' = stage/events where it is in a build tied with the best):");
  const vals = cards.map((c) => {
    const per = SE.map((se) => { const w = builds.filter((k) => k.split("+").includes(c)), wo = builds.filter((k) => !k.split("+").includes(c)); return avg(w.map((k) => avg(scores(k, se.stage, se.event)))) - avg(wo.map((k) => avg(scores(k, se.stage, se.event)))); });
    return { c, m: avg(per), best: Math.max(...per), where: SE[per.indexOf(Math.max(...per))].label, top: inTop.get(c) ?? 0 };
  }).sort((a, b) => b.m - a.m);
  for (const v of vals) console.log(`  ${cardName(v.c).padEnd(17)} avg ${f(v.m)} | best ${f(v.best)} (${v.where}) | top in ${v.top}/10${v.top === 0 && v.best <= 0 ? "   <- DEAD" : v.top === 0 ? "   <- never top" : ""}`);
  // synergy: pair minus the better of its two parts alone, paired by seed
  console.log("\ncombos (pair minus its better half alone, paired by seed; * = real at that stage/event):");
  const pairs = builds.filter((k) => k.split("+").length === 2).map((k) => {
    const [a, b] = k.split("+");
    const per = SE.map((se) => {
      const p = scores(k, se.stage, se.event), x = scores(a, se.stage, se.event), y = scores(b, se.stage, se.event);
      const d = p.map((v, i) => v - Math.max(x[i], y[i]));
      return { label: se.label, m: avg(d), real: real(d) };
    });
    const pos = per.filter((x) => x.real && x.m > 0), neg = per.filter((x) => x.real && x.m < 0);
    return { k, m: avg(per.map((x) => x.m)), pos, neg, best: per.reduce((a, b) => (b.m > a.m ? b : a)) };
  }).sort((a, b) => b.m - a.m);
  for (const p of pairs.slice(0, 8)) console.log(`  + ${name(p.k).padEnd(32)} avg ${f(p.m)} | real gain in ${p.pos.length}/10 (${p.pos.map((x) => x.label).join(", ") || "-"}) | best ${f(p.best.m)} ${p.best.label}`);
  for (const p of pairs.slice(-4)) console.log(`  - ${name(p.k).padEnd(32)} avg ${f(p.m)} | real loss in ${p.neg.length}/10 (${p.neg.map((x) => x.label).join(", ") || "-"})`);
  console.log(`  designed combos: ${[["legs", "energy"], ["eyes", "night?"], ["learning", "taste"], ["belly", "drought?"], ["hunter", "legs"], ["stomach", "(reward)"]].map(([a, b]) => { const p = pairs.find((x) => x.k === [a, b].sort().join("+")); return p ? `${name(p.k)} ${f(p.m)} (${p.pos.length} real+)` : ""; }).filter(Boolean).join(" | ")}`);
  // dominance
  const dom = [...topCount].filter(([, n]) => n >= 7).map(([k, n]) => `${name(k)} (top 3 in ${n}/10)`);
  console.log(`\ndominant builds (top 3 in >= 7 of 10 stage/events): ${dom.join(", ") || "none"}`);
}

if (B.length) {
  console.log("\n################ powers (vs no power, same build/stage/event/seed; * = probably real)");
  for (let si = 0; si < SPECIES.length; si++) {
    const R = B.filter((r) => r.sp === si);
    if (!R.length) continue;
    for (const k of [...new Set(R.map((r) => key(r.cards)))]) {
      console.log(`  ${SPECIES[si].name}, ${name(k)}:`);
      for (const p of Object.keys(POWERS) as (keyof typeof POWERS)[]) for (const at of [0, 30]) {
        const per = SE.map((se) => {
          const base = R.filter((r) => key(r.cards) === k && !r.power && r.stage === se.stage && r.event === se.event).sort((a, b) => a.seed - b.seed);
          const pw = R.filter((r) => key(r.cards) === k && r.power === p && r.at === at && r.stage === se.stage && r.event === se.event).sort((a, b) => a.seed - b.seed);
          const d = pw.map((r, i) => r.score - base[i].score);
          return { label: se.label, m: avg(d), real: real(d) };
        });
        const up = per.filter((x) => x.real && x.m > 0).map((x) => x.label), down = per.filter((x) => x.real && x.m < 0).map((x) => x.label);
        console.log(`    ${POWERS[p].name.padEnd(15)} at gen ${String(at).padEnd(2)} avg ${f(avg(per.map((x) => x.m)))} | helps* ${up.length}/10 ${up.join(", ")} | hurts* ${down.length}/10 ${down.join(", ")}`);
      }
    }
  }
}

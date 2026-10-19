// The recorded runs that pin down behaviour. Used by the tests, by determinism.html (other browsers)
// and by scripts/record-golden.ts. Results live in test/golden.json.
//
// "42", "7", "hello", "custom": the basic rules (no layouts, extra senses or newcomers).
// "defaults": the current default rules.
// Re-record (npm run record-golden) only when a change is MEANT to alter behaviour, and say so in the
// commit. History: the basic cases matched the original single-file version until 2026-10-18, when
// deterministic math (dmath.ts) replaced Math.sin/cos/tanh/log and every number changed.
import { createWorld, runGenerations, runTicks, DEFAULT_RULES, type Rules } from "../engine/world.ts";
import { seedFrom } from "../engine/rng.ts";

// The rules before food layouts, extra senses, newcomers and poison existed.
export const BASE_RULES: Rules = {
  ...DEFAULT_RULES, layouts: 1, senseFood2: 0, senseCreature: 0, walls: 0, newcomers: 0, poison: 0,
};

export interface GoldenCase {
  name: string;
  seed: number;
  rules: Rules;
  gens: number;
  checkBest: boolean; // the "custom" case only recorded averages
  ticks?: number; // ecosystem mode: run this many ticks instead of generations
}

export const CASES: GoldenCase[] = [
  ...["42", "7", "hello"].map((t) => ({ name: t, seed: seedFrom(t), rules: BASE_RULES, gens: 10, checkBest: true })),
  {
    name: "custom", seed: 42, gens: 10, checkBest: false,
    rules: { ...BASE_RULES, pop: 15, food: 20, elite: 0, parents: 50, mutation: 0.4, genTicks: 400 },
  },
  { name: "defaults", seed: seedFrom("42"), rules: DEFAULT_RULES, gens: 3, checkBest: true },
  // ecosystem: avg = population every 100 ticks, best = [births, deaths]
  { name: "ecosystem", seed: seedFrom("42"), rules: { ...DEFAULT_RULES, mode: 1, regrow: 100 }, gens: 0, ticks: 4000, checkBest: true },
];

export interface GoldenResult {
  avg: number[];
  best?: number[];
}

export function runCase(c: GoldenCase): GoldenResult {
  const w = createWorld(c.seed, c.rules);
  if (c.ticks) {
    runTicks(w, c.ticks);
    return { avg: w.eco.popHist, best: [w.eco.births, w.eco.deaths] };
  }
  runGenerations(w, c.gens);
  return c.checkBest ? { avg: w.avgHist, best: w.bestHist } : { avg: w.avgHist };
}

// First difference between a run and its recording, or null if they match exactly.
export function firstDifference(got: GoldenResult, want: GoldenResult): string | null {
  for (const key of ["avg", "best"] as const) {
    const g = got[key];
    const e = want[key];
    if (!g || !e) continue;
    if (g.length !== e.length) return `${key}: ${g.length} generations, expected ${e.length}`;
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== e[i]) return `${key}, generation ${i + 1}: got ${g[i]}, expected ${e[i]}`;
    }
  }
  return null;
}

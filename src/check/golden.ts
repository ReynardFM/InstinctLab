// The recorded runs that pin down behaviour. Used by the tests, by determinism.html (other browsers)
// and by scripts/record-defaults.ts. Results live in test/golden.json.
//
// "42", "7", "hello", "custom": recorded from the original single-file browser version. Never re-record
//   these: if they stop matching, the basic simulation changed.
// "defaults": the current default rules. Re-record (npm run record-defaults) only when a change is
//   MEANT to alter behaviour, and say so in the commit.
import { createWorld, runGenerations, DEFAULT_RULES, type Rules } from "../engine/world.ts";
import { seedFrom } from "../engine/rng.ts";

// The rules before food layouts, extra senses and newcomers existed.
export const BASE_RULES: Rules = {
  ...DEFAULT_RULES, layouts: 1, senseFood2: 0, senseCreature: 0, walls: 0, newcomers: 0,
};

export interface GoldenCase {
  name: string;
  seed: number;
  rules: Rules;
  gens: number;
  checkBest: boolean; // the "custom" case only recorded averages
}

export const CASES: GoldenCase[] = [
  ...["42", "7", "hello"].map((t) => ({ name: t, seed: seedFrom(t), rules: BASE_RULES, gens: 10, checkBest: true })),
  {
    name: "custom", seed: 42, gens: 10, checkBest: false,
    rules: { ...BASE_RULES, pop: 15, food: 20, elite: 0, parents: 50, mutation: 0.4, genTicks: 400 },
  },
  { name: "defaults", seed: seedFrom("42"), rules: DEFAULT_RULES, gens: 3, checkBest: true },
];

export interface GoldenResult {
  avg: number[];
  best?: number[];
}

export function runCase(c: GoldenCase): GoldenResult {
  const w = createWorld(c.seed, c.rules);
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

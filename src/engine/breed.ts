// How a child's brain is made: which parent, and how it is changed.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Genome } from "./brain.ts";
import type { Creature } from "./creature.ts";
import { log } from "./dmath.ts";

// A copy of the genome with random nudges of the given size. With rules.mutationRate below 1 only that
// share of the weights is nudged (sparse mutation); the rest are copied exactly.
// At rate 1 it draws exactly the random numbers it always did, so old runs replay unchanged.
export function mutate(w: World, g: Genome, size: number): Genome {
  const { rng } = w;
  const rate = w.rules.mutationRate;
  if (rate >= 1) return g.map((x) => x + rng.gauss() * size);
  return g.map((x) => (rng.next() < rate ? x + rng.gauss() * size : x));
}

// The "centre" brain, Evolution Strategies style: a weighted average of the best parents' brains,
// better-ranked parents counting more (weights ln(n + 0.5) - ln(rank), as in CMA-ES).
// Only parents from the best creature's family take part: averaging unrelated brains tends to give
// nonsense, because two networks can solve the task with their neurons in a different order.
// The brain a child starts from: the parent's inherited brain plus rules.inheritLearned of what the parent
// learned during its life. Without learning that is exactly the parent's genome (x + 0 = x).
export function inherited(w: World, c: Creature): Genome {
  if (c.w === c.g) return c.g;
  const share = w.rules.inheritLearned;
  const n = c.w.length; // weights; with rules.plasticity the evolved learning rates follow, passed on as they are
  return c.g.map((x, k) => (k < n ? x + share * (c.w[k] - x) : x));
}

export function centre(w: World, ranked: Creature[], parents: number): Genome {
  const fam = ranked[0].family;
  const chosen = ranked.slice(0, parents).filter((c) => c.family === fam);
  const n = chosen.length;
  const weights = chosen.map((_, i) => log(n + 0.5) - log(i + 1));
  const total = weights.reduce((s, x) => s + x, 0);
  const out = new Array(chosen[0].g.length).fill(0);
  for (let i = 0; i < n; i++) {
    const wt = weights[i] / total;
    const g = inherited(w, chosen[i]);
    for (let k = 0; k < out.length; k++) out[k] += wt * g[k];
  }
  return out;
}

// How a child's brain is made: which parent, and how it is changed.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Genome } from "./brain.ts";
import type { Creature } from "./creature.ts";

// A copy of the genome with random nudges of the given size.
export function mutate(w: World, g: Genome, size: number): Genome {
  const { rng } = w;
  return g.map((x) => x + rng.gauss() * size);
}

// The brain a child starts from: the parent's inherited brain plus rules.inheritLearned of what the parent
// learned during its life. Without learning that is exactly the parent's genome (x + 0 = x).
export function inherited(w: World, c: Creature): Genome {
  if (c.w === c.g) return c.g;
  const share = w.rules.inheritLearned;
  const n = c.w.length; // weights; with rules.senseGenes the sense switches follow, passed on as they are
  return c.g.map((x, k) => (k < n ? x + share * (c.w[k] - x) : x));
}

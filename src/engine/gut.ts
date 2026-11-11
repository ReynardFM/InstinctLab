// A stomach (rules.digest, Rey 2026-11-11: "a digest bar ... just consumption, works for prey and hunter"; poison "seeps in while
// digesting"). Eating fills the stomach instead of the body: each meal has a size (room it takes), energy and poison. Every tick the
// stomach hands rules.digest worth of its content to the body, with that share of its energy and of its poison. A full stomach takes
// no more food (a full prey leaves the pellet, a full hunter cannot catch), and a body at top energy stops digesting, so nothing is
// wasted. The stomach is made on the first meal; with rules.digest 0 nobody has one.
export interface Gut { bulk: number; energy: number; toxin: number }
interface Eater { gut?: Gut; energy: number; toxin: number }

export const PELLET = 0.3; // a pellet's size and energy (the same 0.3 as without a stomach)
export const PREY_GUT = 2 * PELLET; // a prey's stomach holds two pellets; a hunter's holds one meal (rules.hunterMeal)

export const gutToxin = (e: Eater): number => (e.gut ? e.gut.toxin : 0);
export const hasRoom = (e: Eater, size: number, cap: number): boolean => (e.gut ? e.gut.bulk : 0) + size <= cap + 1e-9;

export function swallow(e: Eater, size: number, energy: number, toxin: number): void {
  const g = (e.gut ??= { bulk: 0, energy: 0, toxin: 0 });
  g.bulk += size;
  g.energy += energy;
  g.toxin += toxin;
}

// One tick of digestion: up to `rate` of the stomach's content moves on, never past `maxEnergy` in the body.
export function digestTick(e: Eater, rate: number, maxEnergy: number): void {
  const g = e.gut;
  if (!g || !(g.bulk > 0)) return;
  let share = Math.min(1, rate / g.bulk);
  const room = maxEnergy - e.energy;
  if (g.energy * share > room) share = g.energy > 0 ? Math.max(0, room) / g.energy : share; // a full body waits
  if (share >= 1) {
    e.energy += g.energy;
    e.toxin += g.toxin;
    g.bulk = g.energy = g.toxin = 0;
    return;
  }
  e.energy += g.energy * share;
  e.toxin += g.toxin * share;
  g.bulk -= g.bulk * share;
  g.energy -= g.energy * share;
  g.toxin -= g.toxin * share;
}

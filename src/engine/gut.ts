// A stomach (rules.digest, Rey 2026-11-11: "a digest bar ... just consumption, works for prey and hunter"; poison "seeps in while
// digesting"). Eating fills the stomach instead of the body: each meal has a size (room it takes), energy and poison. Every tick the
// stomach hands rules.digest worth of its content to the body, with that share of its energy and of its poison. A full stomach takes
// no more food (a full prey leaves the pellet, a full hunter cannot catch), and a body at top energy stops digesting, so nothing is
// wasted. The stomach is made on the first meal; with rules.digest 0 nobody has one.
export interface Gut { bulk: number; energy: number; toxin: number }
interface Eater { gut?: Gut; energy: number; toxin: number }

export const PELLET = 0.3; // a pellet's size and energy (the same 0.3 as without a stomach)
// rules.preySlow: N above 0 = prey burn 1/N and a pellet gives 1/N (a slower pace of life); the pellet's size in the stomach follows
export const pellet = (r: { preySlow: number }): number => (r.preySlow > 0 ? PELLET / r.preySlow : PELLET);
export const preyPace = (r: { preySlow: number }): number => (r.preySlow > 0 ? 1 / r.preySlow : 1);
export const preyGut = (r: { preySlow: number }): number => 2 * pellet(r); // a prey's stomach holds two pellets; a hunter's one meal (rules.hunterMeal)
export const PREY_GUT = 2 * PELLET;

// How fast a stomach works (Rey 2026-11-11: "balanced like real nature"): rules.digest is a MULTIPLE of what the body burns, so each
// side's stomach matches its own body. Hunters burn rules.hunterHunger per tick; prey burn PREY_BURN at top speed (life.ts: 0.0005 +
// 3 x 0.0004, times rules.energyCost). digest 3 = an animal can take in about three times what it burns (a gorge-and-fast eater).
export const PREY_BURN = 0.0005 + 3 * 0.0004;
export const hunterDigest = (r: { digest: number; hunterHunger: number }): number => r.digest * r.hunterHunger;
export const preyDigest = (r: { digest: number; energyCost: number; preySlow: number }): number => r.digest * PREY_BURN * r.energyCost * preyPace(r);
export const fullness = (e: Eater, cap: number): number => (e.gut ? Math.min(1, e.gut.bulk / cap) : 0);

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

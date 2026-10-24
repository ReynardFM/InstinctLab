// Poison as a food chain (Rey's brief 2026-10-24). Eating a poison pellet raises the eater's poison level
// (toxin); energy use is multiplied by (1 + toxin); the level fades, halving every rules.poisonHalfLife
// ticks. A hunter that catches a prey takes on the prey's whole level. How hard a dose hits depends on the
// eater's age: resistance follows a bell curve over its lifespan, highest at half of it, and newborns and
// the very old take up to 1 / rules.poisonFrail times the dose. Never directly fatal: it starves you faster.
// For now this model runs in ecosystem mode only (newPoison); generations mode keeps the flat POISON_HIT
// until the brief's last step.
import type { World } from "./world.ts"; // types only, no import at run time
import { tanh } from "./dmath.ts";
import { inEcosystem } from "./mode.ts";

const LN2 = 0.6931471805599453;

export const newPoison = (w: World) => inEcosystem(w);

// e^-q for q >= 0, from tanh (dmath has no exp; Math.exp may differ by engine): e^-2y = (1 - tanh y) / (1 + tanh y).
export function expNeg(q: number): number {
  const t = tanh(q / 2);
  return (1 - t) / (1 + t);
}

// Resistance at `age` for a lifespan `life`: frail + (1 - frail) x a bell curve centred at life / 2 with
// spread life / 6 (so a newborn is close to `frail`). life 0 or less = no ageing = full resistance.
export function resistance(age: number, life: number, frail: number): number {
  if (!(life > 0)) return 1;
  const z = (age - life / 2) / (life / 6);
  return frail + (1 - frail) * expNeg((z * z) / 2);
}

// Prey lifespan for the curve (Rey's call 2026-10-24): the age prey actually die at, as a running average
// (every death, caught or starved, moves it 1% of the way), so "middle-aged" moves with the prey. Before the
// first prey death it is 0 = full resistance. (A fixed 2 x ageScale = 6000 put 98% of prey in the newborn band:
// they live about 350 ticks.) Hunters: rules.hunterAge, their fixed death age.
export const PREY_LIFE_RATE = 0.01;
export const preyLife = (w: World) => w.eco.preyLife;
export function notePreyDeath(w: World, age: number): void {
  w.eco.preyLife = w.eco.preyLife > 0 ? w.eco.preyLife + PREY_LIFE_RATE * (age - w.eco.preyLife) : age;
}

// The dose a pellet (or a caught prey's level) gives an eater of this age.
export function dose(amount: number, age: number, life: number, w: World): number {
  return amount / resistance(age, life, w.rules.poisonFrail);
}

// Per-tick fading: halves every poisonHalfLife ticks (first order: x (1 - ln2 / halfLife) per tick).
export function fade(level: number, w: World): number {
  return level > 0 ? level - (level * LN2) / Math.max(1, w.rules.poisonHalfLife) : 0;
}

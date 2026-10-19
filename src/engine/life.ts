// One tick of one creature's life: sense, think, move, pay for it, eat, maybe starve.
// Shared by both modes (generations and ecosystem).
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature } from "./creature.ts";
import { newFood } from "./creature.ts";
import { think } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { sense } from "./senses.ts";
import { H, W } from "./space.ts";

// Energy a creature loses by eating poison (good food gives +0.3).
export const POISON_HIT = 0.5;

// costFactor multiplies the energy cost (ageing in ecosystem mode; 1 otherwise).
export function live(w: World, c: Creature, costFactor: number): void {
  const walls = w.rules.walls > 0;
  const seen = sense(w, c);
  c.inputs = seen.inputs;
  const { hidden, out } = think(c.g, c.inputs);
  c.hidden = hidden;
  c.out = out;

  const speed = ((out[1] + 1) / 2) * 3;
  c.a += out[0] * 0.2;
  if (walls) {
    // walls stop you: slide along them instead of passing through
    c.x = Math.min(Math.max(c.x + cos(c.a) * speed, 0), W);
    c.y = Math.min(Math.max(c.y + sin(c.a) * speed, 0), H);
  } else {
    c.x = (c.x + cos(c.a) * speed + W) % W;
    c.y = (c.y + sin(c.a) * speed + H) % H;
  }
  c.energy -= (0.0005 + speed * 0.0004) * w.rules.energyCost * costFactor; // moving costs energy; standing still costs a little
  if (seen.food && seen.foodDist < 6) {
    if (seen.food.poison) {
      c.poisoned++;
      c.energy -= POISON_HIT;
    } else {
      c.eaten++;
      c.energy = Math.min(c.energy + 0.3, 1.5);
    }
    Object.assign(seen.food, newFood(w, seen.food.poison)); // same kind, somewhere new
    if (w.rules.regrow > 0) seen.food.readyAt = w.tick + w.rules.regrow;
  }
  if (c.energy <= 0) {
    c.alive = false;
    c.diedAt = w.tick;
  }
}


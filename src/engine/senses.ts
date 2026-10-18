// What a creature perceives each tick. Which senses exist is set by the rules; each one adds inputs
// to the brain, so the brain (and the genome) grows with them.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature, Food } from "./creature.ts";
import { IN } from "./brain.ts";
import { H, W, nearest } from "./space.ts";

export interface SenseRules {
  senseFood2: number; // 1 = also sense the second-nearest food
  senseCreature: number; // 1 = sense the nearest other living creature
  walls: number; // 1 = the map has walls instead of wrapping around, and creatures sense the wall ahead
}

export function inputCount(r: SenseRules): number {
  return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.walls ? 1 : 0);
}

export function inputLabels(r: SenseRules): string[] {
  const labels = ["Food left/right", "Food ahead", "Food distance", "Energy"];
  if (r.senseFood2) labels.push("2nd food left/right", "2nd food ahead", "2nd food distance");
  if (r.senseCreature) labels.push("Neighbour left/right", "Neighbour ahead", "Neighbour distance");
  if (r.walls) labels.push("Wall distance ahead");
  return labels;
}

// Where something is, seen from the creature: left/right (-1..1), ahead (-1..1), distance (0..1, 1 = 200 or more).
function towards(dx: number, dy: number, d2: number, heading: number): [number, number, number] {
  const rel = Math.atan2(dy, dx) - heading;
  return [Math.sin(rel), Math.cos(rel), Math.min(Math.sqrt(d2) / 200, 1)];
}

const NOTHING: [number, number, number] = [0, 0, 1]; // nothing there: straight ahead is unknown, far away

// Distance to the wall straight ahead, 0..1 (1 = 200 or more).
export function wallAhead(x: number, y: number, heading: number): number {
  const cx = Math.cos(heading);
  const cy = Math.sin(heading);
  const tx = cx > 0 ? (W - x) / cx : cx < 0 ? -x / cx : Infinity;
  const ty = cy > 0 ? (H - y) / cy : cy < 0 ? -y / cy : Infinity;
  return Math.min(Math.min(tx, ty) / 200, 1);
}

export interface Perception {
  inputs: number[];
  food: Food | null; // nearest food, for eating
  foodDist: number;
}

export function sense(w: World, c: Creature): Perception {
  const r = w.rules;
  const walls = r.walls > 0;
  const foods = nearest(w.food, c.x, c.y, walls, r.senseFood2 ? 2 : 1);
  const f = foods[0];
  // no food at all: same numbers as before senses were split out (distance reads as far)
  const first = f ? towards(f.dx, f.dy, f.d2, c.a) : towards(0, 0, Infinity, c.a);
  const inputs = [...first, c.energy];
  if (r.senseFood2) {
    const s = foods[1];
    inputs.push(...(s ? towards(s.dx, s.dy, s.d2, c.a) : NOTHING));
  }
  if (r.senseCreature) {
    const n = nearest(w.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
    inputs.push(...(n ? towards(n.dx, n.dy, n.d2, c.a) : NOTHING));
  }
  if (walls) inputs.push(wallAhead(c.x, c.y, c.a));
  return { inputs, food: f ? f.item : null, foodDist: f ? Math.sqrt(f.d2) : Infinity };
}

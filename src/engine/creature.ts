// Creatures and food: what they are and how a new one is made.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Genome } from "./brain.ts";
import { inputCount } from "./senses.ts";
import { H, W } from "./space.ts";

export interface Food {
  x: number;
  y: number;
  poison: boolean; // costs energy, worth nothing
  readyAt: number; // tick it (re)appears at; before that it is gone (rules.regrow)
}


export interface Creature {
  id: number;
  family: number; // id of the family this creature belongs to
  branch: number | null; // id of the branch on trial it belongs to, if any
  hue: number; // display colour, inherited with a small drift so branches of a family show up
  elite: boolean; // copied unchanged from last generation
  streak: number; // generations in a row this brain has been copied unchanged as an elite
  g: Genome;
  x: number;
  y: number;
  a: number; // heading, radians
  energy: number;
  eaten: number; // good food this generation, all layouts so far (this is the score)
  poisoned: number; // poison eaten this generation
  alive: boolean;
  diedAt: number | null;
  age: number; // ticks lived (ecosystem mode)
  depth: number; // generations since its founder: 0 for founders, parent's + 1 for a child
  children: number; // children it has had (ecosystem mode)
  // last senses and thoughts, kept so the page can show the brain working
  inputs: number[];
  hidden: number[];
  out: number[];
}


export function newFood(w: World, poison = false): Food {
  return { x: w.env.next() * W, y: w.env.next() * H, poison, readyAt: 0 };
}

// A fresh map: exactly round(poison share x food) pellets are poison, and an eaten pellet comes back as the
// same kind (see step), so the share stays fixed. (A first version rolled the kind for every new pellet:
// creatures ate the good ones and left the poison, so the map filled up with poison.)
export function newFoodLayout(w: World): Food[] {
  const poisonCount = Math.round(w.rules.poison * w.rules.food);
  return Array.from({ length: w.rules.food }, (_, i) => newFood(w, i < poisonCount));
}


// parentHue: null for founders. Elites keep their colour exactly; children drift a little.
export function newCreature(w: World, genome: Genome, family: number, elite: boolean, parentHue: number | null): Creature {
  const { env } = w; // where it starts is the world's luck, not evolution's
  const id = w.nextId++;
  const hue =
    parentHue === null ? founderHue(family) : elite ? parentHue : (parentHue + hueDrift(id) + 360) % 360;
  return {
    id,
    family,
    hue,
    elite,
    branch: null,
    streak: 0,
    g: genome,
    x: env.next() * W,
    y: env.next() * H,
    a: env.next() * Math.PI * 2,
    energy: 1,
    eaten: 0,
    poisoned: 0,
    alive: true,
    diedAt: null,
    age: 0,
    depth: 0,
    children: 0,
    inputs: new Array(inputCount(w.rules)).fill(0),
    hidden: new Array(w.rules.hidden).fill(0),
    out: [0, 0],
  };
}

// Golden angle: neighbouring founders get clearly different colours.
export function founderHue(family: number): number {
  return (family * 137.508) % 360;
}

// -8..+8 degrees, derived from the id with a hash instead of the world's random numbers,
// so colours can never change how evolution plays out.
export function hueDrift(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 16 - 8;
}

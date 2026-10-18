// The simulation. No drawing, no DOM, no clock: only the World object and functions on it.
// Same seed + same rules = same run, at any speed, in the browser or in Node.
import { createRng, type Rng } from "./rng.ts";
import { genomeSize, think } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { H, W } from "./space.ts";
import { inputCount, sense } from "./senses.ts";
import { newCreature, newFood, type Creature, type Food } from "./creature.ts";
import {
  addNewcomer, crownChampions, judgeBranches, maybeSplit, newFamily, protectNewcomers, recordFamilyStats,
  settleLineage, type Branch, type Family,
} from "./lineage.ts";

// What other files import from the engine, in one place.
export { H, W, wrapDelta } from "./space.ts";
export { founderHue, hueDrift, type Creature, type Food } from "./creature.ts";
export { brainDistance, retire, LEGACY_LIMIT, type Branch, type Family } from "./lineage.ts";

export interface Rules {
  pop: number; // creatures per generation
  food: number; // food pellets on the map at once
  genTicks: number; // length of one generation
  elite: number; // best N copied unchanged
  parents: number; // children come from the best N
  mutation: number; // size of the random nudge per weight
  splitDistance: number; // a child this different from its family's main brain founds a new family; 0 = never
  championStreak: number; // an elite on top this many generations in a row becomes its family's main brain; 0 = never
  layouts: number; // food layouts each brain is scored on per generation; scores add up. 1 = one layout (luckier)
  splitProof: number; // a branch must out-eat the rest of its family this many generations in a row to become a family; 0 = at once
  senseFood2: number; // 1 = creatures also sense the second-nearest food
  senseCreature: number; // 1 = creatures sense the nearest other creature
  walls: number; // 1 = walls instead of wrapping around, plus a sense for the wall ahead
  newcomers: number; // new families per generation, made by mutating a good parent very hard; 0 = none
  newcomerMutation: number; // how hard: the size of the random nudge per weight for a newcomer
  protectGens: number; // generations a newcomer family keeps 2 seats (its best + one child) whatever its rank
}

export const DEFAULT_RULES: Rules = {
  pop: 40, food: 60, genTicks: 1500, elite: 2, parents: 8, mutation: 0.15, splitDistance: 0.6, championStreak: 3, layouts: 3, splitProof: 3,
  senseFood2: 0, senseCreature: 1, walls: 0,
  newcomers: 1, newcomerMutation: 0.4, protectGens: 3,
};

export interface World {
  rules: Rules;
  rng: Rng;
  creatures: Creature[];
  food: Food[];
  tick: number;
  generation: number;
  layout: number; // which food layout of this generation is running, from 0
  avgHist: number[]; // average food eaten per layout, one entry per finished generation
  bestHist: number[];
  worstHist: number[];
  topHalfHist: number[]; // average of the better half, per layout: not dragged down by weak newcomers
  nextId: number;
  families: Map<number, Family>; // families with living members
  legacy: Family[]; // extinct families, oldest first, at most LEGACY_LIMIT
  nextFamilyId: number;
  splits: number; // how many new families have formed this run
  branches: Map<number, Branch>; // branches on trial
  nextBranchId: number;
  failedBranches: number; // branches that died out before proving themselves
  newcomerCount: number; // newcomer families made this run
}

export function createWorld(seed: number, rules: Rules): World {
  const w: World = {
    rules: { ...rules },
    rng: createRng(seed),
    creatures: [],
    food: [],
    tick: 0,
    generation: 1,
    layout: 0,
    avgHist: [],
    bestHist: [],
    worstHist: [],
    topHalfHist: [],
    nextId: 0,
    families: new Map(),
    legacy: [],
    nextFamilyId: rules.pop,
    splits: 0,
    branches: new Map(),
    nextBranchId: 0,
    failedBranches: 0,
    newcomerCount: 0,
  };
  for (let i = 0; i < rules.pop; i++) {
    const genome = Array.from({ length: genomeSize(inputCount(rules)) }, () => w.rng.gauss() * 0.5);
    w.creatures.push(newCreature(w, genome, i, false, null));
    w.families.set(i, newFamily(i, genome, null, 1));
  }
  w.food = Array.from({ length: rules.food }, () => newFood(w));
  return w;
}

export function step(w: World): void {
  const walls = w.rules.walls > 0;
  for (const c of w.creatures) {
    if (!c.alive) continue;
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
    c.energy -= 0.0005 + speed * 0.0004; // moving costs energy; standing still costs a little
    if (seen.food && seen.foodDist < 6) {
      c.eaten++;
      c.energy = Math.min(c.energy + 0.3, 1.5);
      Object.assign(seen.food, newFood(w));
    }
    if (c.energy <= 0) {
      c.alive = false;
      c.diedAt = w.tick;
    }
  }
  w.tick++;
  if (w.tick >= w.rules.genTicks || w.creatures.every((c) => !c.alive)) {
    if (w.layout + 1 < w.rules.layouts) nextLayout(w);
    else nextGeneration(w);
  }
}

// Same brains, fresh start on a new food layout. Food eaten keeps adding up, so one lucky map
// can't decide who breeds. Everyone shares the same layout, so the comparison stays fair.
function nextLayout(w: World): void {
  w.layout++;
  for (const c of w.creatures) {
    c.x = w.rng.next() * W;
    c.y = w.rng.next() * H;
    c.a = w.rng.next() * Math.PI * 2;
    c.energy = 1;
    c.alive = true;
    c.diedAt = null;
  }
  w.food = Array.from({ length: w.rules.food }, () => newFood(w));
  w.tick = 0;
}

// Runs until `generations` more generations have finished.
export function runGenerations(w: World, generations: number): void {
  const target = w.generation + generations;
  while (w.generation < target) step(w);
}

function nextGeneration(w: World): void {
  const { rules, rng } = w;
  const ranked = [...w.creatures].sort((a, b) => b.eaten - a.eaten); // fitness = food eaten, all layouts
  const per = Math.max(1, rules.layouts); // history is per layout, so runs with different layouts compare
  w.avgHist.push(ranked.reduce((s, c) => s + c.eaten, 0) / ranked.length / per);
  w.bestHist.push(ranked[0].eaten / per);
  w.worstHist.push(ranked[ranked.length - 1].eaten / per);
  const half = ranked.slice(0, Math.ceil(ranked.length / 2));
  w.topHalfHist.push(half.reduce((s, c) => s + c.eaten, 0) / half.length / per);

  const elite = Math.min(rules.elite, rules.pop);
  const parents = Math.max(1, Math.min(rules.parents, rules.pop));
  const next: Creature[] = [];
  recordFamilyStats(w, ranked, per);
  const proven = judgeBranches(w, ranked);
  for (let i = 0; i < elite; i++) {
    const copy = newCreature(w, ranked[i].g.slice(), ranked[i].family, true, ranked[i].hue);
    copy.streak = ranked[i].streak + 1;
    copy.branch = ranked[i].branch;
    next.push(copy);
  }
  crownChampions(w, next);
  protectNewcomers(w, ranked, next, elite);
  for (let i = 0; i < rules.newcomers && next.length < rules.pop; i++) addNewcomer(w, ranked, next, parents);
  while (next.length < rules.pop) {
    const p = ranked[Math.floor(rng.next() * parents)];
    const child = newCreature(w, p.g.map((x) => x + rng.gauss() * rules.mutation), p.family, false, p.hue);
    child.branch = p.branch;
    maybeSplit(w, child);
    next.push(child);
  }
  w.creatures = next;
  settleLineage(w, proven);
  w.food = Array.from({ length: rules.food }, () => newFood(w));
  w.tick = 0;
  w.layout = 0;
  w.generation++;
}

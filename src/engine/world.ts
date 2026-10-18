// The simulation. No drawing, no DOM, no clock: only the World object and functions on it.
// Same seed + same rules = same run, at any speed, in the browser or in Node.
import { createRng, type Rng } from "./rng.ts";
import { genomeSize, HID, think, type Genome } from "./brain.ts";
import { H, W } from "./space.ts";
import { inputCount, sense } from "./senses.ts";

export { H, W, wrapDelta } from "./space.ts";

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

// Most recent extinct families kept in the legacy record.
export const LEGACY_LIMIT = 500;

export interface Family {
  id: number;
  ref: Genome; // the family's main brain: splits are measured against it
  founderRef: Genome; // the brain the family started from (never changes)
  champions: { generation: number; genome: Genome }[]; // every time a champion replaced the main brain
  parent: number | null; // family it split from; null for the original founders
  bornGeneration: number;
  diedGeneration: number | null; // last generation with living members; null while still alive
  peakSize: number; // most members in any one generation
  bestEaten: number; // most food any member ate in one generation, per layout
  avgHist: number[]; // members' average food per layout, one entry per generation it had members
  newcomer: boolean; // started as a newcomer (a hard-mutated copy of a parent from family `parent`)
  protectedUntil: number; // its seats are guaranteed in generations before this one; 0 = never protected
}

// A group of creatures whose brains drifted far from their family's main brain, on trial.
// They stay in their family until they out-eat the rest of it rules.splitProof generations in a row.
export interface Branch {
  id: number;
  family: number; // the family it may split from
  ref: Genome; // brain of the child that started it; later drifters within splitDistance of it join
  bornGeneration: number;
  wins: number; // generations in a row it out-ate the rest of its family
}

export interface Food {
  x: number;
  y: number;
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
  eaten: number; // this generation, all layouts so far
  alive: boolean;
  diedAt: number | null;
  // last senses and thoughts, kept so the page can show the brain working
  inputs: number[];
  hidden: number[];
  out: number[];
}

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
      c.x = Math.min(Math.max(c.x + Math.cos(c.a) * speed, 0), W);
      c.y = Math.min(Math.max(c.y + Math.sin(c.a) * speed, 0), H);
    } else {
      c.x = (c.x + Math.cos(c.a) * speed + W) % W;
      c.y = (c.y + Math.sin(c.a) * speed + H) % H;
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
  for (const b of proven) promote(w, b);
  // branches with no members left failed their trial
  const inBranch = new Set(next.map((c) => c.branch));
  for (const id of [...w.branches.keys()]) {
    if (!inBranch.has(id)) {
      w.branches.delete(id);
      w.failedBranches++;
    }
  }
  // families with no descendants left move to the legacy record
  const alive = new Set(next.map((c) => c.family));
  for (const fam of [...w.families.values()]) if (!alive.has(fam.id)) retire(w, fam, w.generation);
  w.food = Array.from({ length: rules.food }, () => newFood(w));
  w.tick = 0;
  w.layout = 0;
  w.generation++;
}

// Speciation: a child that has drifted far enough from its family's main brain starts a branch on trial
// (or, with splitProof 0, a new family at once). Pure bookkeeping: families and branches never affect
// who breeds, so evolution plays out the same either way.
function maybeSplit(w: World, child: Creature): void {
  const limit = w.rules.splitDistance;
  if (child.branch !== null) return; // already on trial: its brain is judged by the branch's results
  const fam = w.families.get(child.family);
  if (!limit || !fam || brainDistance(child.g, fam.ref) <= limit) return;
  // a relative may already have split off from this family: join it instead of founding a near-duplicate
  for (const f of w.families.values()) {
    if (f.parent === child.family && brainDistance(child.g, f.ref) <= limit) {
      child.family = f.id;
      child.hue = founderHue(f.id);
      return;
    }
  }
  if (w.rules.splitProof > 0) {
    for (const b of w.branches.values()) {
      if (b.family === child.family && brainDistance(child.g, b.ref) <= limit) {
        child.branch = b.id;
        return;
      }
    }
    const id = w.nextBranchId++;
    w.branches.set(id, { id, family: child.family, ref: child.g.slice(), bornGeneration: w.generation + 1, wins: 0 });
    child.branch = id;
    return;
  }
  const id = w.nextFamilyId++;
  w.families.set(id, newFamily(id, child.g, child.family, w.generation + 1));
  child.family = id;
  child.hue = founderHue(id);
  w.splits++;
}

// After each generation: did each branch out-eat the rest of its family (average food)?
// A branch whose family has no other members left wins by default: it outlived the old line.
// Returns the branches that have now won rules.splitProof generations in a row.
function judgeBranches(w: World, ranked: Creature[]): Branch[] {
  const proven: Branch[] = [];
  for (const b of w.branches.values()) {
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (const c of ranked) {
      if (c.branch === b.id) {
        inSum += c.eaten;
        inN++;
      } else if (c.family === b.family) {
        outSum += c.eaten;
        outN++;
      }
    }
    if (inN === 0) continue; // born this generation: nothing to judge yet
    const won = outN === 0 || inSum / inN > outSum / outN;
    b.wins = won ? b.wins + 1 : 0;
    if (b.wins >= w.rules.splitProof) proven.push(b);
  }
  return proven;
}

// A proven branch becomes a family of its own.
function promote(w: World, b: Branch): void {
  w.branches.delete(b.id);
  const id = w.nextFamilyId++;
  w.families.set(id, newFamily(id, b.ref, b.family, w.generation + 1));
  w.splits++;
  for (const c of w.creatures) {
    if (c.branch === b.id) {
      c.branch = null;
      c.family = id;
      c.hue = founderHue(id);
    }
  }
}

function newFamily(id: number, genome: Genome, parent: number | null, bornGeneration: number): Family {
  return {
    id, ref: genome.slice(), founderRef: genome.slice(), champions: [], parent, bornGeneration,
    diedGeneration: null, peakSize: 0, bestEaten: 0, avgHist: [], newcomer: false, protectedUntil: 0,
  };
}

// A newcomer: a good parent's brain mutated very hard, starting a family of its own. It is far from
// everything, so it would almost always lose straight away; protection gives it time to improve.
function addNewcomer(w: World, ranked: Creature[], next: Creature[], parents: number): void {
  const { rules, rng } = w;
  const p = ranked[Math.floor(rng.next() * parents)];
  const genome = p.g.map((x) => x + rng.gauss() * rules.newcomerMutation);
  const id = w.nextFamilyId++;
  const born = w.generation + 1;
  const fam = newFamily(id, genome, p.family, born);
  fam.newcomer = true;
  fam.protectedUntil = born + rules.protectGens;
  w.families.set(id, fam);
  w.newcomerCount++;
  next.push(newCreature(w, genome, id, false, null));
}

// While protected, a newcomer family's best member keeps its seat and has one child, whatever its rank:
// a tiny evolution of its own. If that member is already an elite, only the child is added.
function protectNewcomers(w: World, ranked: Creature[], next: Creature[], elite: number): void {
  const { rules, rng } = w;
  for (const fam of w.families.values()) {
    if (!fam.newcomer || w.generation >= fam.protectedUntil) continue;
    const i = ranked.findIndex((c) => c.family === fam.id);
    if (i < 0) continue;
    const best = ranked[i];
    if (i >= elite && next.length < rules.pop) {
      const keep = newCreature(w, best.g.slice(), fam.id, true, best.hue);
      keep.elite = false; // not one of the overall best: it keeps its seat only because it is protected
      keep.branch = best.branch;
      next.push(keep);
    }
    if (next.length < rules.pop) {
      const child = newCreature(w, best.g.map((x) => x + rng.gauss() * rules.mutation), fam.id, false, best.hue);
      child.branch = best.branch;
      maybeSplit(w, child);
      next.push(child);
    }
  }
}

// Size, best and average score of each family in the generation that just finished (branch members count
// for their family).
function recordFamilyStats(w: World, ranked: Creature[], per: number): void {
  const sizes = new Map<number, number>();
  const sums = new Map<number, number>();
  for (const c of ranked) {
    sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
    sums.set(c.family, (sums.get(c.family) ?? 0) + c.eaten);
    const fam = w.families.get(c.family);
    if (fam && c.eaten / per > fam.bestEaten) fam.bestEaten = c.eaten / per;
  }
  for (const [id, n] of sizes) {
    const fam = w.families.get(id);
    if (!fam) continue;
    if (n > fam.peakSize) fam.peakSize = n;
    fam.avgHist.push(sums.get(id)! / n / per);
  }
}

// An elite that has stayed on top for rules.championStreak generations becomes its family's main brain,
// and splits are measured against it from then on. Elites arrive best-first, so only the family's
// highest-ranked elite can be crowned. Measured: with default rules a streak of 5 never happened in
// 500 generations (scores are mostly luck), 3 happens about 1-2 times per 100 generations.
function crownChampions(w: World, elites: Creature[]): void {
  if (!w.rules.championStreak) return;
  const seen = new Set<number>();
  for (const c of elites) {
    if (c.branch !== null || seen.has(c.family)) continue; // a branch on trial can't crown its family's brain
    seen.add(c.family);
    const fam = w.families.get(c.family);
    if (fam && c.streak === w.rules.championStreak) {
      fam.ref = c.g.slice();
      fam.champions.push({ generation: w.generation + 1, genome: c.g.slice() });
    }
  }
}

// Moves an extinct family into the legacy record, keeping only the most recent LEGACY_LIMIT.
export function retire(w: World, fam: Family, lastGeneration: number): void {
  fam.diedGeneration = lastGeneration;
  w.families.delete(fam.id);
  w.legacy.push(fam);
  if (w.legacy.length > LEGACY_LIMIT) w.legacy.splice(0, w.legacy.length - LEGACY_LIMIT);
}

// Root-mean-square difference per weight. 0 = identical brains.
export function brainDistance(a: Genome, b: Genome): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

function newFood(w: World): Food {
  return { x: w.rng.next() * W, y: w.rng.next() * H };
}

// parentHue: null for founders. Elites keep their colour exactly; children drift a little.
function newCreature(w: World, genome: Genome, family: number, elite: boolean, parentHue: number | null): Creature {
  const { rng } = w;
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
    x: rng.next() * W,
    y: rng.next() * H,
    a: rng.next() * Math.PI * 2,
    energy: 1,
    eaten: 0,
    alive: true,
    diedAt: null,
    inputs: new Array(inputCount(w.rules)).fill(0),
    hidden: new Array(HID).fill(0),
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


// The simulation. No drawing, no DOM, no clock: only the World object and functions on it.
// Same seed + same rules = same run, at any speed, in the browser or in Node.
import { createRng, type Rng } from "./rng.ts";
import { think, type Genome } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { centre, inherited, mutate } from "./breed.ts";
import { stepEcosystem } from "./ecosystem.ts";
import { live } from "./life.ts";
import { inEcosystem } from "./mode.ts";
export { inEcosystem } from "./mode.ts";
export { POISON_HIT } from "./life.ts";
import { H, W } from "./space.ts";
import { sense } from "./senses.ts";
import { genomeLength, newCreature, newFood, newFoodLayout, type Creature, type Food } from "./creature.ts";
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
  elite: number; // best N copied unchanged (with learning on, they carry rules.inheritLearned of what they learned, like any child)
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
  mutationRate: number; // share of weights nudged in each child; 1 = all of them (dense), 0.2 = sparse
  centreShare: number; // share of children made from the centre brain (Evolution Strategies) instead of one parent
  hidden: number; // middle neurons in each brain (more = can learn more complex behaviour, more weights to evolve)
  poison: number; // share of food that is poison (costs POISON_HIT energy, worth nothing); 0 = none
  regrow: number; // ticks before eaten food reappears somewhere new; 0 = at once
  energyCost: number; // multiplies the energy cost of living and moving; 1 = normal
  mode: number; // 0 = generations (everyone replaced together); 1 = ecosystem (continuous births and deaths)
  birth: number; // ecosystem: 0 = a full creature splits off a child; 1 = two full creatures that meet have one
  birthEnergy: number; // ecosystem: energy needed to have a child (the most a creature can hold is 1.5)
  ageScale: number; // ecosystem: at this age living costs double, at twice it triple...; 0 = no ageing
  ecoWarmup: number; // ecosystem: ordinary generations first, so it starts with brains that can already eat
  learnRate: number; // learning during life: how much a reward changes recently active connections; 0 = off
  inheritLearned: number; // share of the parent's learned changes its children are born with (0.75 = 75%)
  thinkCost: number; // energy per tick for a fully busy brain (scaled by how strongly it fires); 0 = free
  learnCost: number; // energy per unit of weight change from learning; 0 = free
  forget: number; // learning: share of the learned change that fades back toward the inborn brain each tick (0.002 = about 350 ticks to halve); 0 = never
  relativeReward: number; // learning: 1 = a meal counts only as better or worse than the creature's usual intake; 0 = food +1, poison -1
  plasticity: number; // learning: 1 = every connection has its own learning rate, evolved in the genome (genome doubles); 0 = one rate for all
  swapKinds: number; // 1 = on each food map, a coin flip decides whether the two pellet looks swap roles (purple rings become the food). Born brains can't know which; only learning during life can tell
  energyGate: number; // learning: 1 = learn in proportion to current energy (hungry creatures learn less); 0 = off
}


export const DEFAULT_RULES: Rules = {
  pop: 40, food: 60, genTicks: 1500, elite: 2, parents: 8, mutation: 0.15, splitDistance: 0.6, championStreak: 3, layouts: 3, splitProof: 3,
  senseFood2: 0, senseCreature: 1, walls: 0,
  newcomers: 1, newcomerMutation: 0.4, protectGens: 3,
  mutationRate: 1, centreShare: 0, hidden: 6,
  poison: 0.3, regrow: 0, energyCost: 1, // poison on: creatures visibly learn to avoid it (5% of intake vs 30% blind)
  mode: 0, birth: 0, birthEnergy: 1.2, ageScale: 3000, ecoWarmup: 20,
  learnRate: 0, inheritLearned: 0.75, thinkCost: 0, learnCost: 0,
  forget: 0.002, relativeReward: 1, energyGate: 0, swapKinds: 0, plasticity: 0,
};

export interface World {
  rules: Rules;
  seed: number; // the run's seed: each food map's random numbers are derived from it (layoutSeed)
  rng: Rng; // evolution's random numbers: starting brains, mutation, which parents breed
  env: Rng; // the world's random numbers: food positions and starting spots. Kept separate so that two
  // settings run with the same seed get the same food layouts, and comparing them seed by seed cancels
  // that luck (common random numbers). Each food map starts its own stream (layoutSeed), so the maps of
  // a generation don't depend on each other and can run on separate cores (stage 3b, cli/split.ts).
  creatures: Creature[];
  food: Food[];
  tick: number;
  generation: number;
  layout: number; // which food layout of this generation is running, from 0
  swapped: boolean; // rules.swapKinds: on this food map, purple rings are the food and green dots the poison
  avgHist: number[]; // average food eaten per layout, one entry per finished generation
  bestHist: number[];
  worstHist: number[];
  topHalfHist: number[]; // average of the better half, per layout: not dragged down by weak newcomers
  poisonHist: number[]; // average poison eaten per creature, per layout
  nextId: number;
  families: Map<number, Family>; // families with living members
  legacy: Family[]; // extinct families, oldest first, at most LEGACY_LIMIT
  nextFamilyId: number;
  splits: number; // how many new families have formed this run
  branches: Map<number, Branch>; // branches on trial
  nextBranchId: number;
  failedBranches: number; // branches that died out before proving themselves
  newcomerCount: number; // newcomer families made this run
  eco: EcoStats; // ecosystem mode only
}

export interface EcoStats {
  births: number;
  deaths: number;
  oldAge: number; // deaths of creatures older than ageScale (they starved, but ageing is why)
  rescues: number; // times everyone had died and fresh founders were put in
  popHist: number[]; // population, sampled every ECO_SAMPLE ticks
  ageHist: number[]; // average age, same samples
  recentDeaths: { x: number; y: number; tick: number }[]; // for the page's death marks (last 200)
}

// start: a saved brain (hall of fame): every creature starts with a copy of it instead of a random one.
// Or one brain per creature (cli/split.ts rebuilds a generation on another thread this way).
export function createWorld(seed: number, rules: Rules, start?: Genome | Genome[]): World {
  const each = start && Array.isArray(start[0]) ? (start as Genome[]) : null;
  const one = start && !each ? (start as Genome) : null;
  for (const g of each ?? (one ? [one] : [])) {
    if (g.length !== genomeLength(rules)) {
      throw new Error(`This brain has ${g.length} weights; these rules need ${genomeLength(rules)} (different senses or brain size)`);
    }
  }
  if (each && each.length !== rules.pop) throw new Error(`${each.length} brains for ${rules.pop} creatures`);
  const w: World = {
    rules: { ...rules },
    seed,
    rng: createRng(seed),
    env: createRng(envSeed(seed)),
    creatures: [],
    food: [],
    tick: 0,
    generation: 1,
    layout: 0,
    swapped: false,
    avgHist: [],
    bestHist: [],
    worstHist: [],
    topHalfHist: [],
    poisonHist: [],
    nextId: 0,
    families: new Map(),
    legacy: [],
    nextFamilyId: rules.pop,
    splits: 0,
    branches: new Map(),
    nextBranchId: 0,
    failedBranches: 0,
    newcomerCount: 0,
    eco: { births: 0, deaths: 0, oldAge: 0, rescues: 0, popHist: [], ageHist: [], recentDeaths: [] },
  };
  for (let i = 0; i < rules.pop; i++) {
    const genome = each ? each[i].slice() : one ? one.slice() : Array.from({ length: genomeLength(rules) }, () => w.rng.gauss() * 0.5);
    w.creatures.push(newCreature(w, genome, i, false, null));
    w.families.set(i, newFamily(i, genome, null, 1));
  }
  startLayout(w);
  return w;
}

export function step(w: World): void {
  if (inEcosystem(w)) {
    stepEcosystem(w);
    return;
  }
  if (tickLayout(w)) {
    if (w.layout + 1 < w.rules.layouts) nextLayout(w);
    else nextGeneration(w);
  }
}

// One tick of the current food map; true when the map is over (time is up, or everyone starved).
export function tickLayout(w: World): boolean {
  for (const c of w.creatures) if (c.alive) live(w, c, 1);
  w.tick++;
  return w.tick >= w.rules.genTicks || w.creatures.every((c) => !c.alive);
}

// Runs the world for a number of ticks (ecosystem mode has no generations to count).
export function runTicks(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

// Same brains, fresh start on a new food layout. Food eaten keeps adding up, so one lucky map
// can't decide who breeds. Everyone shares the same layout, so the comparison stays fair.
function nextLayout(w: World): void {
  w.layout++;
  startLayout(w);
}

// The start of a food map (w.generation, w.layout): its own random numbers, everyone back to a random
// spot with full energy, fresh food. Nothing carries over from the map before except food eaten, so the
// maps of a generation can be played in any order or at the same time with the same result. With
// learning on, each map starts from the inborn brain: what was learned on one map is not carried to the
// next (children still inherit what was learned on the last map, see breed.inherited).
export function startLayout(w: World): void {
  w.env = createRng(layoutSeed(w.seed, w.generation, w.layout));
  for (const c of w.creatures) {
    c.x = w.env.next() * W;
    c.y = w.env.next() * H;
    c.a = w.env.next() * Math.PI * 2;
    c.energy = 1;
    c.alive = true;
    c.diedAt = null;
    if (c.w !== c.g) {
      for (let k = 0; k < c.w.length; k++) c.w[k] = c.g[k];
      c.trace.fill(0);
      c.usual = 0;
    }
  }
  w.food = newFoodLayout(w);
  w.tick = 0;
}

// A second seed for the world's random numbers, derived from the run's seed (integer hash).
export function envSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return Math.imul(h, 0x165667b1) | 0;
}

// The seed of one food map: the run's seed, the generation and the map number, mixed (integer hash).
export function layoutSeed(seed: number, generation: number, layout: number): number {
  let h = envSeed(seed);
  h = Math.imul(h ^ generation, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h ^ layout, 0x85ebca6b);
  h ^= h >>> 13;
  return h | 0;
}

// Runs until `generations` more generations have finished.
export function runGenerations(w: World, generations: number): void {
  const target = w.generation + generations;
  while (w.generation < target) step(w);
}

// Ranks the creatures by food eaten over all maps and breeds the next generation. Exported for
// cli/split.ts, which plays the maps on separate threads and then calls this.
export function nextGeneration(w: World): void {
  const { rules, rng } = w;
  const ranked = [...w.creatures].sort((a, b) => b.eaten - a.eaten); // fitness = food eaten, all layouts
  const per = Math.max(1, rules.layouts); // history is per layout, so runs with different layouts compare
  w.avgHist.push(ranked.reduce((s, c) => s + c.eaten, 0) / ranked.length / per);
  w.bestHist.push(ranked[0].eaten / per);
  w.worstHist.push(ranked[ranked.length - 1].eaten / per);
  const half = ranked.slice(0, Math.ceil(ranked.length / 2));
  w.topHalfHist.push(half.reduce((s, c) => s + c.eaten, 0) / half.length / per);
  w.poisonHist.push(ranked.reduce((s, c) => s + c.poisoned, 0) / ranked.length / per);

  const elite = Math.min(rules.elite, rules.pop);
  const parents = Math.max(1, Math.min(rules.parents, rules.pop));
  const next: Creature[] = [];
  recordFamilyStats(w, ranked, per);
  const proven = judgeBranches(w, ranked);
  for (let i = 0; i < elite; i++) {
    const copy = newCreature(w, inherited(w, ranked[i]).slice(), ranked[i].family, true, ranked[i].hue);
    copy.streak = ranked[i].streak + 1;
    copy.branch = ranked[i].branch;
    next.push(copy);
  }
  crownChampions(w, next);
  protectNewcomers(w, ranked, next, elite);
  for (let i = 0; i < rules.newcomers && next.length < rules.pop; i++) addNewcomer(w, ranked, next, parents);
  const centreBrain = rules.centreShare > 0 ? centre(w, ranked, parents) : null;
  while (next.length < rules.pop) {
    // a share of children come from the centre brain; the family, colour and branch of the best go with it
    const fromCentre = centreBrain !== null && (rules.centreShare >= 1 || rng.next() < rules.centreShare);
    const p = fromCentre ? ranked[0] : ranked[Math.floor(rng.next() * parents)];
    const child = newCreature(w, mutate(w, fromCentre ? centreBrain : inherited(w, p), rules.mutation), p.family, false, p.hue);
    child.branch = p.branch;
    maybeSplit(w, child);
    next.push(child);
  }
  w.creatures = next;
  settleLineage(w, proven);
  w.layout = 0;
  w.generation++;
  startLayout(w);
}

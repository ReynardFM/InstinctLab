// The simulation. No drawing, no DOM, no clock: only the World object and functions on it.
// Same seed + same rules = same run, at any speed, in the browser or in Node.
import { createRng, type Rng } from "./rng.ts";
import { think, type Genome } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { inherited, mutate } from "./breed.ts";
import { stepEcosystem } from "./ecosystem.ts";
import { live } from "./life.ts";
import { breedHunters, huntersArrived, moveHunters, placeHunters, type BestBrain, type Hunter, type HunterBrain, type HunterStats } from "./hunters.ts";
import { inEcosystem } from "./mode.ts";
export { inEcosystem } from "./mode.ts";
export { POISON_HIT } from "./life.ts";
import { H, W } from "./space.ts";
import { prepareGrids, sense, type Grids } from "./senses.ts";
import { markSafe, genomeLength, newCreature, newFood, newFoodLayout, type Creature, type Food } from "./creature.ts";
import { SENSE_GENES } from "./genes.ts";
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
  hidden: number; // middle neurons in each brain (more = can learn more complex behaviour, more weights to evolve)
  poison: number; // share of food that is poison (costs POISON_HIT energy, worth nothing); 0 = none
  regrow: number; // ticks before eaten food reappears somewhere new; 0 = at once
  poisonDose: number; // ecosystem: poison level a pellet adds at full resistance (toxin.ts); 0 = harmless
  poisonHalfLife: number; // ecosystem: ticks for the poison level to halve
  poisonFrail: number; // ecosystem: resistance of newborns and the very old (0.25 = they take 4x the dose)
  hunterDoseCap: number; // ecosystem: the most poison a hunter takes from one prey (after age frailty); 0 = no cap.
  // Rey 2026-11-02 (a): keep the food chain but make a poisoned catch painful, not deadly. Window: above 0.5 the
  // learning reward (1 - 2 x dose) is negative; below ~0.8 the extra hunger (0.0025 x dose x 721 ticks) stays under 1.5 energy
  hunterResistGene: number; // generations mode, brain hunters (Rey 2026-11-02: breed resistance by hand): 1 = each hunter
  // brain carries an inborn resistance gene 0..1 (founders 0, children = parent + mutation); its score pays for poison
  hunterResistSlow: number; // with hunterResistGene: resistance costs speed, top speed x (1 - this x gene) (Rey 2026-11-02, b:
  // like TTX-resistant garter snakes crawling slower); 0 = no speed cost
  genPreyToxin: number; // generations mode with hunterResistGene: poison level every prey carries (a side arena of poisoned prey)
  hunterLearn: number; // ecosystem: hunters learn during life (taste aversion): clean catch +1, poisoned down to -1; 0 = off. Reward and forgetting follow rules.relativeReward and rules.forget, shared with prey (merged 2026-11-03)
  hunterBite: number; // brain hunters (restored 2026-11-09, Rey: "choice"; first built 2026-11-02): above 0 = a third output, bite: a prey in reach
  // is caught only if it is above 0. Its weights ride at the end of the hunter genome (inherited and mutated, not learned); this value is
  // added to the bite sum as a start bias toward biting (1: most bite at first)
  hunterPoisonHalfLife: number; // ecosystem (Rey 2026-11-10: "bigger metabolism, faster poison degrade"): ticks for poison to halve in a
  // hunter; 0 = the same as prey (poisonHalfLife). One dose D costs a hunter about hunterHunger x D x half-life / ln 2 extra energy
  hunterIdle: number; // ecosystem (Rey 2026-11-11): share of hunterHunger a hunter standing still pays (rising in a line to all of it at top
  // speed), so waiting is cheaper than chasing; 0 = off: hunger is the same at every speed (as before)
  digest: number; // ecosystem (Rey 2026-11-11: "a digest bar"): above 0 = prey and hunters have a stomach (gut.ts). A meal fills the
  // stomach; each tick it hands the body this many times what the body burns (hunters: x hunterHunger; prey: x their top-speed burn),
  // with that share of the meal's energy and poison (poison seeps in). A full stomach takes no more (prey: two pellets; hunters: one
  // meal), hunters no longer rest after a catch, and every brain gets one more input: how full its stomach is. 3 = "can take in three
  // times what it burns". Must be above 1 (or a full animal starves). 0 = off (as before)
  resistGene: number; // ecosystem (Rey 2026-11-10, built 2026-11-11): above 0 = every prey and hunter carries an inborn poison resistance
  // 0..1 (harm = level x (1 - resistance)), passed to its babies with a small random nudge (RESIST_STEP, toxin.ts), founders start at 0.
  // The value is the upkeep as a SHARE of what the body burns (hunters: x hunterHunger; prey: x their top-speed burn 0.0017): 0.3 = a
  // fully resistant body burns 30% more. (Until 2026-11-11 23:00 it was a flat energy per tick; 0.0005 then = 0.3 now for prey, and it
  // was 80% of a slow hunter's hunger, which kept hunter resistance near 0.) 0 = off (no resistance)
  hunterSightTrade: number; // ecosystem, with hunterCue 2 and resistGene (Rey 2026-11-19: a trade-off between seeing and resisting): 1 = a
  // hunter sees a prey's glow as min(1, poison x 10 x (1 - its resistance)): low resistance = sharp eyes for poison, high = dim. 0 = off
  safePrey: number; // ecosystem (Rey 2026-11-20, a check: "other food" for hunters): the share of prey that are of a SAFE kind, which never
  // eats poison plants, so it is never sick. Each baby is safe with this chance (not inherited, so the share stays put, like a second
  // species); founders / restarts: the first ones in the list. 0 = off: one kind of prey (as before)
  hunterEarlyBreed: number; // ecosystem (Rey 2026-11-13: "poison can help breed early but maybe die early"): a poisoned hunter has its baby
  // at lower energy: hunterBirth x (1 - this x harm), harm capped at 1. 0.3 = 30% lower at full poison. 0 = off
  hunterHangover: number; // ecosystem (Rey 2026-11-13: "debuff, like shutting off one sense after poison wears off"): above 0 = for
  // hunters poison no longer raises hunger; instead, when the poison wears off (falls under SICK) a hangover starts that lasts as long
  // as the poison did. 1 = no sight of the sickness cue (glow); 2 = the eye reaches half as far; 3 = both. 0 = off (hunger harm, as before)
  poisonRamp: number; // ecosystem with spreading food (Rey 2026-11-13): ticks over which the share of poison plants among all plants rises
  // (with season > 0: the swing, 2026-11-24: quarters alternate normal share / poisonPeak, each change taking poisonRamp ticks; plants.ts rampShare)
  // in a straight line from the normal world's own share (0.23 with poison 0.3, food 60) to rules.poisonPeak, then holds (plants.ts). 0 = off
  poisonPeak: number; // with poisonRamp: the share of poison plants among ALL plants at the end of the ramp (below 1: prey get energy only from clean plants)
  seasonFarm: number; // with season: the NUMBER of farms in the farm seasons (3rd and 4th quarter: plants packed into farm zones). 2 =
  // the two big farms built 2026-11-09 (radius 110); more = scattered smaller farms with the same total area (8 = radius 55; Rey
  // 2026-11-11: "scattered farms", after nature's many small patches); 0 = no farm seasons, only the poison swings (clean / poison /
  // clean / poison)
  season: number; // ecosystem with spreading food (Rey 2026-11-09): ticks in a year; 0 = no seasons. Four quarters: foraging (plants all over,
  // no poison plants), poison foraging (twice the poison), farm (plants packed into farm zones, no poison), poison farm (plants.ts)
  hunterCue: number; // ecosystem (Rey 2026-11-06; replaces hunterSeeSpeed): what hunters see of a prey's sickness. 0 blind; 1 speed (poison slows
  // prey, but healthy prey also choose to go slow, so the cue drifts and can flip); 2 glow = min(poison, 1), a mark prey can't hide
  // (3 / 4 / 5 = shuffled glow, scent, shuffled scent: deleted 2026-11-19, HISTORY.md)
  foodSpread: number; // ecosystem: food spreads like plants: chance per tick that a pellet sprouts a new one nearby; 0 = off (plants.ts). With hunters: 0.0005 and food 60 (or food 120 without it)
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
  hunters: number; // dumb hunters that chase the nearest prey (generations mode); 0 = none
  hunterSense: number; // 1 = prey sense the nearest hunter (when there are hunters); 2 = blind: the same 3 inputs, always
  // reading "nothing there" (a fair control: same brain size, no information)
  hunterSpeed: number; // hunters' speed (prey: up to 3)
  hunterBrains: number; // 1 = hunters have brains and evolve, scored by prey caught (hunters.ts); 0 = chasers
  hunterPool: number; // hunters with brains: brains kept (gene pool); each food map uses rules.hunters of them in turn
  hunterHunger: number; // ecosystem: energy a hunter loses each tick
  hunterMeal: number; // ecosystem: energy a hunter gains per catch (it holds at most 1.5)
  hunterBirth: number; // ecosystem: energy at which a hunter splits off a baby (half its energy goes to it)
  hunterAge: number; // ecosystem: a hunter dies at this age (ticks)
  hunterMature: number; // ecosystem: age before a hunter can have babies
  hunterBirthChance: number; // ecosystem: chance per tick that a full adult hunter has a baby, just after it
  // matures; it falls in a straight line to 0 at hunterAge (older = harder)
  hunterFrom: number; // generation the hunters arrive in (1 = from the start). With brains, half of the first
  // hunters borrow the main brains of extinct prey families, so give the prey some generations first
  swapKinds: number; // 1 = on each food map, a coin flip decides whether the two pellet looks swap roles (purple rings become the food). Born brains can't know which; only learning during life can tell
  senseGenes: number; // 1 = each optional sense (2nd food, neighbour, poison, hunter) is switched on by a gene at the end of the genome (on when > 0); founders start with all off, mutation can switch them on (Rey 2026-10-31: senses evolved, not handed out)
  remains: number; // ecosystem: a dying prey (starved, old or caught) leaves remains for this many ticks: food for prey that
  // carries the dead prey's poison level (Rey 2026-11-02: prey gather at remains); 0 = off
  eyeMotion: number; // with the eye: 1 = prey also see how fast each hunter moves (closeness x speed), switched with the hunter gene
  hunterEye: number; // 0 = hunters keep the old "nearest X" senses; 4 or 8 = hunters see prey, prey motion and hunters with a raw eye
  eye: number; // 0 = off; 4 or 8 = raw all-around eye with that many slices instead of the "nearest X" senses (senses.ts eyeInto; Rey 2026-10-31)
  senseCost: number; // with senseGenes: energy per tick for each switched-on sense (eyes cost something)
  energyGate: number; // learning: 1 = learn in proportion to current energy (hungry creatures learn less); 0 = off
}


export const DEFAULT_RULES: Rules = {
  pop: 40, food: 60, genTicks: 1500, elite: 2, parents: 8, mutation: 0.15, splitDistance: 0.6, championStreak: 3, layouts: 3, splitProof: 3,
  senseFood2: 0, senseCreature: 1, walls: 0,
  newcomers: 1, newcomerMutation: 0.4, protectGens: 3,
  hidden: 6, senseGenes: 0, senseCost: 0, eye: 0, eyeMotion: 0, hunterEye: 0, remains: 0,
  poison: 0.3, regrow: 0, energyCost: 1, // poison on: creatures visibly learn to avoid it (5% of intake vs 30% blind)
  mode: 0, birth: 0, birthEnergy: 1.2, ageScale: 3000, ecoWarmup: 20,
  learnRate: 0, inheritLearned: 0.75, thinkCost: 0, learnCost: 0,
  forget: 0.002, relativeReward: 1, energyGate: 0, swapKinds: 0,
  hunters: 0, hunterSense: 1, hunterSpeed: 2, hunterBrains: 0, hunterPool: 12, hunterFrom: 1,
  poisonDose: 1, poisonHalfLife: 500, poisonFrail: 0.25, hunterCue: 1, season: 0, seasonFarm: 2, poisonRamp: 0, poisonPeak: 0.9, hunterEarlyBreed: 0, hunterHangover: 0, safePrey: 0, hunterSightTrade: 0, hunterBite: 0, hunterPoisonHalfLife: 0, hunterIdle: 0, resistGene: 0, digest: 0, hunterLearn: 0.02,
  hunterDoseCap: 0, hunterResistGene: 0, hunterResistSlow: 0, genPreyToxin: 0, // off: no prey defence emerged (README 2026-10-26)
  // SLOW hunters are the default since 2026-11-11 (Rey: "hunter will default slow"): hunterHunger 0.000625 and hunterMeal 0.125, a quarter
  // of the old 0.0025 / 0.5 (tuned with food 120, README 2026-10-23). Same needed catch rate, a body's store lasts 4x longer, a baby
  // costs ~5 catches. Proofs 2026-11-11: works about the same, hunter die-outs 3-7x fewer (HISTORY.md).
  foodSpread: 0, hunterHunger: 0.000625, hunterMeal: 0.125, hunterBirth: 1.4, hunterAge: 6000, hunterMature: 1000, hunterBirthChance: 0.03, // tuned with food 120 (README 2026-10-23)
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
  hunters: Hunter[]; // rules.hunters: where the hunters are on this food map
  hunterBrains: HunterBrain[]; // rules.hunterBrains: the hunters' brains, kept across maps and generations
  hunterHist: HunterStats[]; // rules.hunterBrains: how the hunters did, one entry per generation they hunted in
  nextHunterId: number;
  hrng: Rng; // the hunters' random numbers (first brains, breeding): separate, so the prey's draws don't change
  caughtHist: number[]; // share of prey caught per food map, one entry per finished generation
  grids: Grids | null; // where food and creatures are, for fast senses; rebuilt at the start of each tick
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
  measure: boolean; // count the extra ecosystem measures (EcoStats.m; npm run eco-lab). Counting only: no effect on the run
}

// A round of the ecosystem with hunters: from its start until one side (or both) died out.
export interface Round {
  start: number;
  end: number;
  died: "prey" | "hunters" | "both";
}

export interface EcoStats {
  births: number;
  remainsEaten: number; // rules.remains: remains eaten by prey
  deaths: number;
  oldAge: number; // deaths of creatures older than ageScale (they starved, but ageing is why)
  rescues: number; // times everyone had died and fresh founders were put in
  popHist: number[]; // population, sampled every ECO_SAMPLE ticks
  ageHist: number[]; // average age, same samples
  recentDeaths: { x: number; y: number; tick: number }[]; // for the page's death marks (last 200)
  farms: number[]; // rules.season: the farm zones' centres [x1, y1, x2, y2], drawn once when the first farm season starts; empty before
  // hunters (rules.hunters > 0)
  huntersStarted: boolean;
  hunterPopHist: number[]; // hunters alive, same samples as popHist
  caught: number; // prey caught
  hunterBirths: number;
  hunterDeaths: number;
  hunterOldAge: number; // hunter deaths from old age (rules.hunterAge)
  rounds: Round[]; // finished rounds: one side died out
  roundStart: number; // tick the current round started
  bestPrey: BestBrain[]; // longest-lived prey so far (restart brains)
  bestHunters: BestBrain[]; // hunters that caught the most in their life so far (restart brains)
  // poison levels (toxin.ts), added up at every sample: prey by age band (young < 1/4 of the lifespan, middle,
  // old > 3/4), and hunters (all, and how many carried any poison: level above 0.05)
  sick: { caught: number; caughtSick: number; sickShare: number; samples: number; poisonEaten: number }; // poisoned prey: catches of
  // sick prey (level above SICK) vs their share of the living (summed at samples), and poison pellets eaten by prey
  resist: { prey: number; preyN: number; hunter: number; hunterN: number }; // resistance, summed at samples
  // eco-lab measures (World.measure): poison eaten by prey with a hunter within MEASURE_NEAR px vs none, per
  // MEASURE_WINDOW ticks; and per family (to see whether poison-eating families grow)
  m: { win: { nearEat: number; farEat: number; nearTicks: number; farTicks: number }[]; fam: Map<number, { eat: number; ticks: number; nearEat: number; nearTicks: number }> };
  preyLife: number; // average age prey die at (running average, toxin.ts); 0 before the first death
  toxin: { band: [number, number, number]; bandN: [number, number, number]; hunter: number; hunterN: number; hunterSick: number };
  // counting only (Rey 2026-11-02, "do small doses add up?"): catches and poison taken, by the caught prey's level
  // (bins: 0, <=0.02, <=0.05, <=SICK 0.1, <=0.3, more); hunter deaths and their hunger factor (1 + harm) at death
  dose: { n: number[]; taken: number[]; deaths: number; deathHarm: number; deathsHarmed: number;
    // brain-hunter catches by where the prey was vs the hunter's heading: [ahead (< 45 deg), side, behind (> 90 deg)]
    dirSick: number[]; dirClean: number[];
    // zero point (counting only, Rey 2026-11-04): per brain-hunter catch, the sick share among the OTHER prey, as a random hunter would meet it.
    // [catches, sum of share] pairs: whole world, within 50 px of the hunter, within 200 px, within 25 px, within 12 px (catch reach is 6); a catch with no other prey in range is left out of that pair
    zero: number[];
    // rules.hunterBite: prey in reach, [bitten, refused], sick and clean (counted every tick the prey stays in reach)
    biteSick: number[]; biteClean: number[] };
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
    grids: null,
    hunters: [],
    hunterBrains: [],
    hunterHist: [],
    nextHunterId: 0,
    hrng: createRng(hunterSeed(seed)),
    caughtHist: [],
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
    eco: {
      births: 0, remainsEaten: 0, deaths: 0, oldAge: 0, rescues: 0, popHist: [], ageHist: [], recentDeaths: [], farms: [],
      huntersStarted: false, hunterPopHist: [], caught: 0, hunterBirths: 0, hunterDeaths: 0, hunterOldAge: 0,
      rounds: [], roundStart: 0, bestPrey: [], bestHunters: [],
      preyLife: 0,
      m: { win: [], fam: new Map() },
      resist: { prey: 0, preyN: 0, hunter: 0, hunterN: 0 },
      sick: { caught: 0, caughtSick: 0, sickShare: 0, samples: 0, poisonEaten: 0 },
      toxin: { band: [0, 0, 0], bandN: [0, 0, 0], hunter: 0, hunterN: 0, hunterSick: 0 },
      dose: { n: [0, 0, 0, 0, 0, 0], taken: [0, 0, 0, 0, 0, 0], deaths: 0, deathHarm: 0, deathsHarmed: 0, dirSick: [0, 0, 0], dirClean: [0, 0, 0], zero: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], biteSick: [0, 0], biteClean: [0, 0] },
    },
    measure: false,
  };
  for (let i = 0; i < rules.pop; i++) {
    const genome = each ? each[i].slice() : one ? one.slice() : Array.from({ length: genomeLength(rules) }, () => w.rng.gauss() * 0.5);
    if (rules.senseGenes > 0 && !each && !one) for (let s = 1; s <= SENSE_GENES; s++) genome[genome.length - s] = -0.5; // founders: every optional sense off
    w.creatures.push(newCreature(w, genome, i, false, null));
    w.families.set(i, newFamily(i, genome, null, 1));
  }
  if (rules.safePrey > 0) markSafe(w.creatures, rules.safePrey); // rules.safePrey: the first ones are the safe kind
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
  prepareGrids(w);
  for (const c of w.creatures) if (c.alive) live(w, c, 1);
  w.grids = null;
  if (w.hunters.length) moveHunters(w);
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
  if (huntersArrived(w)) placeHunters(w); // drawn last: the food is the same as without hunters
  else w.hunters = [];
  w.tick = 0;
}

// A second seed for the world's random numbers, derived from the run's seed (integer hash).
export function envSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return Math.imul(h, 0x165667b1) | 0;
}

// The seed of the hunters' random numbers (World.hrng).
export function hunterSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x68756e74, 0x9e3779b1);
  h ^= h >>> 16;
  return Math.imul(h, 0x85ebca6b) | 0;
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
  if (huntersArrived(w)) w.caughtHist.push(ranked.reduce((s, c) => s + c.caught, 0) / ranked.length / per);
  if (rules.hunterBrains > 0) breedHunters(w); // own random numbers: the prey's draws below are unchanged

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
  while (next.length < rules.pop) {
    const p = ranked[Math.floor(rng.next() * parents)];
    const child = newCreature(w, mutate(w, inherited(w, p), rules.mutation), p.family, false, p.hue);
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

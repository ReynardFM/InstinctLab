// Learning-game world, one tick at a time (the page watches it; evolution runs it flat out).
// Same arithmetic and random-number order as proto/tune.ts, so the page reproduces the measured numbers.
import { sin, cos, tanh } from "../../src/engine/dmath.ts";
import { createRng, type Rng } from "../../src/engine/rng.ts";

export const SIZE = 400, T = 800, POP = 30, EVERY = 5, HELD = [101, 102], BAR = 0.8;
const SLICE = 40; // ticks between pauses when evolution shares the page with drawing
const SEE = 150, FLEE_AT = 60, BITE = 6, CATCH = 8, HUNTER_SPEED = 1.9, REST = 20, HUNT_SEE = 120;
const HUNGER = 0.0015, MEAL = 0.3, POISON = 0.35, EMAX = 1.5;

export type Sense = "poison" | "taste" | "hunter" | "energy" | "neighbour" | "terrain";
export interface Level { id: string; name: string; good: number; bad: number; hunters: number; menu: Sense[]; blurb: string; sight?: number; terrain?: Terrain }

// ---------- Terrain (Rey 2026-10-30: powers that add stuff to the world; picks "D" = river, farm, safe zone) ----------
// Test only (EXPERIMENT.terrain), placed once per run from its seed and kept on training AND test maps; the bot plays
// the same map but ignores the terrain, so a gain means evolution learned to use it. Placement follows real land:
// a bending river (bend radius ~2-3x width, USGS/Leopold), the farm on the floodplain inside a bend, the safe zone
// on higher ground behind the farm. Rey's rules: the river slows everyone and can drown anyone (hunters too);
// the farm combines overgrazing (fewer beads ripen when crowded, piospheres), ripening waves, and hunters
// patrolling its edge (lions kill where prey is catchable: Hopcraft 2005); the safe zone keeps hunters out,
// grows no food, and breaks when hunters push at it, then regrows. Sensed only with the See terrain card.
export interface Terrain {
  river: { y0: number; amp: number; phase: number; width: number } | null;
  farm: { x: number; y: number; r: number } | null;
  raid?: boolean; // disaster: hunters have found the farm and patrol its edge (Rey: a disaster that comes after a few generations)
  zone: { x: number; y: number; r: number } | null;
}
export const RIVER_SLOW = 0.5, DROWN = 0.002, FARM_BEADS = 15, RIPEN = 120, CROWD_K = 5, ZONE_HP = 200, ZONE_DOWN = 150, TERRAIN_IN = 8;
export function makeTerrain(seed: number, feats: string[]): Terrain {
  const r = createRng(seed * 31 + 7);
  const y0 = r.next() * SIZE, phase = r.next() * 2 * Math.PI, fxr = r.next() * SIZE, fyr = r.next() * SIZE;
  const river = feats.includes("river") ? { y0, amp: 40, phase, width: 24 } : null;
  const fr = 45, zr = 25;
  // farm: inside the bend at the river's crest (towards the river's middle line), else a seeded spot
  let fx = fxr, fy = fyr;
  if (river) { fx = ((((Math.PI / 2 - phase) / (2 * Math.PI)) * SIZE) % SIZE + SIZE) % SIZE; fy = mod(river.y0 + river.amp - river.width / 2 - fr - 5 + SIZE); }
  const farm = feats.includes("farm") ? { x: fx, y: fy, r: fr } : null;
  const zone = feats.includes("zone") ? { x: fx, y: mod(fy - (fr + zr + 10) + SIZE), r: zr } : null; // behind the farm, away from the river
  return { river, farm, zone };
}
const riverOffset = (rv: NonNullable<Terrain["river"]>, x: number, y: number) => wrap(y - (rv.y0 + rv.amp * sin((2 * Math.PI * x) / SIZE + rv.phase)));
const inCircle = (c: { x: number; y: number; r: number }, x: number, y: number) => { const dx = wrap(x - c.x), dy = wrap(y - c.y); return dx * dx + dy * dy < c.r * c.r; };

// ---------- v2 (Rey 2026-10-29): body cards, events, powers, learning in life ----------
// Guard rule: each one changes the learning problem evolution must solve, never the score directly.
export type BodyCard = "legs" | "eyes" | "stomach" | "belly";
export type Card = Sense | BodyCard;
export const BODY_CARDS: BodyCard[] = ["legs", "eyes", "stomach", "belly"];
export const CARD_INFO: Record<Card, { name: string; gain: string; cost: string }> = {
  poison: { name: "See poison", gain: "direction of the nearest poison", cost: "" },
  hunter: { name: "See hunter", gain: "direction of the nearest hunter", cost: "" },
  energy: { name: "Feel energy", gain: "knows how full it is", cost: "" },
  taste: { name: "Taste", gain: "was my last bite poison?", cost: "" },
  neighbour: { name: "See neighbour", gain: "direction of the nearest other creature", cost: "" },
  terrain: { name: "See terrain", gain: "where the river, farm and safe zone are", cost: "" },
  legs: { name: "Long legs", gain: "+15% speed", cost: "+50% hunger" },
  eyes: { name: "Sharp eyes", gain: "sees 33% further", cost: "+15% hunger" },
  stomach: { name: "Tough stomach", gain: "poison hurts 50% less", cost: "food gives 20% less" },
  belly: { name: "Big belly", gain: "stores 50% more energy", cost: "+10% hunger" },
};
export interface Body { speed: number; hunger: number; poisonHurt: number; meal: number; emax: number; seeMul: number; learn: number; sprint: number }
// Experiments for the balance tests (Rey 2026-10-30, round 2 follow-up: "all test"). All off by default, so the
// game and every recorded result are unchanged. Only proto/tune-v2.ts switches them on (--zero=1, --sprint=1).
//   zeroSenses (T1): a fresh species' brains start with weight 0 on every sense input except food (NEAT's
//     "start minimal"): a new sense can't add noise before evolution finds a use. Same random numbers drawn.
//   sprintLegs (T3): Long legs no longer cost hunger all the time. Instead the brain gets a 5th output,
//     "sprint": when it is on, speed x SPRINT and hunger x SPRINT^2 (the cost of moving grows with speed).
//     Evolution must learn when sprinting pays.
//   energyMove (Rey 2026-10-30, call 2a: dead senses get their own move; "test both"): Feel energy adds a
//     move. "rest": stand still, hunger x0.5. "slow": walk at half speed, hunger x0.5.
//   tasteMove: Taste adds a move. "spit": right after a poison bite, get half the damage back, then stand still
//     SPIT_STUN ticks (softens poison, doesn't cancel it). "avoid": walk away from the spot of the last
//     poison bite (remembered for AVOID_MEMORY ticks).
//   See neighbour gives position but nothing in the world makes a neighbour matter (Rey 2026-10-30: "AB",
//   from the behaviour research: public information / Trafalgar effect; predator confusion / selfish herd):
//   neighbourInfo (A): the sense also tells "my nearest neighbour fled last tick" and "alarm: a creature was
//     caught within ALARM_R px in the last ALARM_T ticks" (+2 inputs).
//   confusion (B, a world rule): a hunter's catch fails when 2+ other creatures are within CONF_R px of its
//     target (a group of 3+); the confused hunter pauses CONF_REST ticks.
//   follow (B): See neighbour adds a move, "follow": head for the nearest other creature.
//   ownThreats (Rey 2026-10-30, call 5a: each species gets its own threat; picks S2 and C1):
//     sprinter = ambush hunters (S2): hunters sit still and hidden (See hunter can't see them) until prey comes
//       within AMBUSH_R, then burst at AMBUSH_SPEED (faster than the sprinter) for BURST_T ticks. Speed alone no
//       longer saves it: it must flee the moment a hunter breaks cover.
//     scavenger = toxin build-up (C1, detox limit: Freeland & Janzen 1974): each poison bite adds 1 toxin, the
//       body clears DETOX per tick, and toxin above TOX_FREE drains TOX_HARM energy per tick per unit. Eating
//       poison slowly is safe, binging is not.
//   legs / stomach (Rey 2026-10-30, call 3a: weaken them, a card must soften the stage's threat, not cancel it):
//     legs = [speed x, hunger x] instead of [1.15, 1.5]; stomach = [poison hurt x, food x] instead of [0.5, 0.8].
export const EXPERIMENT: { zeroSenses: boolean; sprintLegs: boolean; energyMove: "" | "rest" | "slow"; tasteMove: "" | "spit" | "avoid"; neighbourInfo: boolean; confusion: boolean; follow: boolean; legs: [number, number] | null; stomach: [number, number] | null; ownThreats: boolean; terrain: string[]; farmRaid: number; legsGrow: number; terrainMoves: boolean; thirst: boolean; memory: number } =
  { zeroSenses: false, sprintLegs: false, energyMove: "", tasteMove: "", neighbourInfo: false, confusion: false, follow: false, legs: null, stomach: null, ownThreats: false, terrain: [], farmRaid: 0, legsGrow: 0, terrainMoves: false, thirst: false, memory: 0 };
//   memory (Rey 2026-10-30: "add more sensing and output"; Claude: raw extra inputs measured worse every time, the
//     real gap is that the brain only sees this tick): M memory cells = M extra outputs fed back as M inputs on
//     the next tick (the simplest recurrent network). They start at 0 and are not moves.
//   thirst (Rey 2026-10-30, "a" = real needs, thirst first; research: features that only move food around add
//     nothing (ideal free distribution) and selfish use wins individual selection (Waibel 2009); a need is
//     individual and adds value): every creature has a water meter that empties in THIRST_T ticks; empty = dead.
//     It refills while the creature is in the river (DRINK per tick), where it is slow and may drown (a first
//     version with a separate "drink" move was learned poorly: two steps, go and then stand still). Every creature feels its thirst and whether it is wet (+2 inputs); See terrain shows where the
//     river is and, with terrain moves, adds "go to water". The bot drinks too (when below 35%).
export const THIRST_T = 200, DRINK = 0.1, BOT_THIRSTY = 0.35;
//   terrainMoves (Rey 2026-10-30, "a, a"): a sense only helps when a move uses it, so See terrain also brings three
//     moves: go to the safe zone, go to the farm, get out of the water.
//   farmRaid (Rey 2026-10-30): the farm is overgrazing + ripening waves only; "watched by hunters" becomes a disaster:
//     from this many generations into a stage, hunters patrol the farm's edge until the stage ends (0 = never).
//   legsGrow (Rey 2026-10-30: legs starts very small and becomes useful only after some evolution): the speed bonus
//     grows from 0 to +15% over this many generations after legs is picked (hunger x1.5 from the start). 0 = off.
export const AMBUSH_R = 50, AMBUSH_SPEED = 3.2, BURST_T = 25, DETOX = 0.01, TOX_FREE = 2, TOX_HARM = 0.004;
export const SPRINT = 1.3, SPIT_STUN = 20, AVOID_MEMORY = 100, ALARM_R = 80, ALARM_T = 60, CONF_R = 40, CONF_N = 2, CONF_REST = 10;
// Brain outputs: eat, avoid, flee, wander, then (experiments only) the energy move, the taste move, follow, sprint.
export const nOut = (build: Sense[], body: Body) => 4 + (EXPERIMENT.energyMove && build.includes("energy") ? 1 : 0) + (EXPERIMENT.tasteMove && build.includes("taste") ? 1 : 0) + (EXPERIMENT.follow && build.includes("neighbour") ? 1 : 0) + (EXPERIMENT.terrainMoves && build.includes("terrain") ? 3 : 0) + (EXPERIMENT.thirst && EXPERIMENT.terrainMoves && build.includes("terrain") ? 1 : 0) + (body.sprint ? 1 : 0) + EXPERIMENT.memory;
const LEARN_DECAY = 0.9, LEARN_COST = 0.002;
// Species body times the cards (multiplying by nothing keeps today's numbers exactly).
export function makeBody(sp: Species, cards: BodyCard[] = [], legsAge = 0): Body {
  const b: Body = { speed: sp.speed, hunger: sp.hunger, poisonHurt: sp.poisonHurt, meal: MEAL, emax: EMAX, seeMul: 1, learn: 0, sprint: 0 };
  // Round 1 of the exhaustive test (2026-10-29): speed decided almost everything (legs top in 10/10,
  // speed-cost cards at the bottom), learning in life dead. Rey's call (c): costs move to hunger.
  if (cards.includes("legs")) { if (EXPERIMENT.sprintLegs) b.sprint = SPRINT; else if (EXPERIMENT.legsGrow > 0) { b.speed *= 1 + 0.15 * Math.min(1, legsAge / EXPERIMENT.legsGrow); b.hunger *= 1.5; } else if (EXPERIMENT.legs) { b.speed *= EXPERIMENT.legs[0]; b.hunger *= EXPERIMENT.legs[1]; } else { b.speed *= 1.15; b.hunger *= 1.5; } }
  if (cards.includes("eyes")) { b.seeMul *= 200 / 150; b.hunger *= 1.15; }
  if (cards.includes("stomach")) { if (EXPERIMENT.stomach) { b.poisonHurt *= EXPERIMENT.stomach[0]; b.meal *= EXPERIMENT.stomach[1]; } else { b.poisonHurt *= 0.5; b.meal *= 0.8; } }
  if (cards.includes("belly")) { b.emax *= 1.5; b.hunger *= 1.1; }
  // learning in life (b.learn): no card uses it now (measured dead); the mechanism stays for later ideas
  return b;
}
export type EventId = "calm" | "drought" | "night" | "bloom" | "swarm";
export const EVENTS: Record<EventId, { name: string; info: string; hard: boolean; apply: (lv: Level) => Level }> = {
  calm: { name: "Calm", info: "nothing extra", hard: false, apply: (lv) => lv },
  drought: { name: "Drought", info: "40% less food", hard: true, apply: (lv) => ({ ...lv, good: Math.round(lv.good * 0.6) }) },
  night: { name: "Night", info: "sight 40% shorter", hard: true, apply: (lv) => ({ ...lv, sight: (lv.sight ?? 1) * 0.6 }) },
  bloom: { name: "Toxic bloom", info: "50% more poison", hard: true, apply: (lv) => ({ ...lv, bad: Math.round(lv.bad * 1.5) }) },
  swarm: { name: "Swarm", info: "+3 hunters", hard: true, apply: (lv) => ({ ...lv, hunters: lv.hunters + 3 }) },
};
export type Power = "food" | "shelter" | "burst" | "cull";
export const POWERS: Record<Power, { name: string; info: string; cost: number; gens: number }> = {
  food: { name: "Food drop", info: "+50% food in training", cost: 2, gens: 10 },
  shelter: { name: "Shelter", info: "no hunters in training", cost: 3, gens: 10 },
  burst: { name: "Mutation burst", info: "mutations x3", cost: 2, gens: 5 },
  cull: { name: "Cull", info: "only the top 3 become parents", cost: 2, gens: 5 },
};
// T2 test powers (2026-10-30, not in the game): round 2 measured the game's powers as doing nothing, and
// easier training (shelter, food drop) slightly hurt. These make training harder or varied instead
// (desirable difficulties; Kashtan, Noor & Alon 2007: varying goals can speed up evolution). Test maps unchanged.
export type TestPower = "hard" | "hardlong" | "switch" | "dark";
export const TEST_POWERS: Record<TestPower, { name: string; info: string; gens: number }> = {
  hard: { name: "Hard practice", info: "threat x2 in training (poison and hunters)", gens: 10 },
  hardlong: { name: "Hard practice, rest of stage", info: "threat x2 in training until the stage ends", gens: 60 },
  switch: { name: "Switching", info: "training alternates every 2 generations: no threat, then threat x2", gens: 20 },
  dark: { name: "Dark practice", info: "sight 40% shorter in training", gens: 10 },
};
export type AnyPower = Power | TestPower;
const powerGens = (k: AnyPower) => (k in POWERS ? POWERS[k as Power].gens : TEST_POWERS[k as TestPower].gens);
// Reward-modulated Hebbian learning on a working copy of the brain (same layout as think()).
function traceStep(tr: number[], inp: number[], layers: number[], bufs: number[][], out: number[]): void {
  let k = 0, pre: number[] = inp, n = inp.length;
  const step = (a: number, b: number) => { tr[k] = LEARN_DECAY * tr[k] + a * b; k++; };
  for (let l = 0; l < layers.length; l++) {
    const post = bufs[l];
    for (let j = 0; j < layers[l]; j++) { for (let i = 0; i < n; i++) step(pre[i], post[j]); step(1, post[j]); }
    pre = post; n = layers[l];
  }
  for (let j = 0; j < out.length; j++) { for (let i = 0; i < n; i++) step(pre[i], out[j]); step(1, out[j]); }
}
function learnFrom(w: number[], tr: number[], amount: number): number {
  let change = 0;
  for (let k = 0; k < w.length; k++) { const d = amount * tr[k]; w[k] += d; change += d < 0 ? -d : d; }
  return change;
}
// Tuned in proto/tune.ts (5 seeds x 300 generations): the right pair learns 5/5, the trap pair 0/5.
export const LEVELS: Level[] = [
  { id: "L1", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"],
    blurb: "20 of the 50 beads here are poison. Eating poison costs energy and a point." },
  { id: "L2", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"],
    blurb: "Six hunters roam. A caught creature is out for the rest of the round." },
];
// Species (Rey 2026-10-29: roguelite, each species its own goal, body and starting sense).
// goal = what the stage score counts, always against this species' own hand-written bot:
//   clean = food - poison   eaten = food + poison (anything swallowed)   alive = ticks survived
export type Goal = "clean" | "eaten" | "alive";
export interface Species { id: string; name: string; goal: Goal; speed: number; hunger: number; poisonHurt: number; start: Sense[]; blurb: string }
export const SPECIES: Species[] = [
  { id: "grazer", name: "Grazer", goal: "clean", speed: 2, hunger: 1, poisonHurt: 1, start: [],
    blurb: "Goal: clean food (food minus poison). Normal body." },
  { id: "sprinter", name: "Sprinter", goal: "alive", speed: 2.5, hunger: 1.5, poisonHurt: 1, start: ["hunter"],
    blurb: "Goal: stay alive. Fast, but gets hungry 1.5x faster. Starts able to see hunters." },
  { id: "scavenger", name: "Scavenger", goal: "eaten", speed: 2, hunger: 1, poisonHurt: 0.4, start: ["energy"],
    blurb: "Goal: swallow as much as possible, poison included. Poison hurts it only 40%. Starts able to feel its energy." },
];
export const goalValue = (s: Stats, g: Goal) => (g === "clean" ? s.score : g === "eaten" ? s.good + s.bad : s.life);
export const SENSE_INFO: Record<Sense, string> = {
  poison: "see poison: direction and distance of the nearest poison bead",
  taste: "taste: was my last bite poison?",
  hunter: "see hunter: direction and distance of the nearest hunter",
  energy: "feel energy: how full am I?",
  neighbour: "see neighbour: direction and distance of the nearest other creature",
  terrain: "see terrain: river side and distance, direction of the farm and the safe zone",
};
export const ACTIONS = ["eat", "avoid", "flee", "wander"] as const;

export interface Stats { score: number; good: number; bad: number; hunted: number; starved: number; life: number } // life = ticks alive
const newStats = (): Stats => ({ score: 0, good: 0, bad: 0, hunted: 0, starved: 0, life: 0 });

// Player choices for evolution (brief A, 2026-10-28). The level's goal never changes: progress is always
// the clean score (good - bad) against the bot; these only change what evolution rewards and how it searches.
export type Reward = "balanced" | "glutton" | "survivor";
export const REWARD_INFO: Record<Reward, string> = {
  balanced: "+1 per food, -1 per poison (same as the level's goal)",
  glutton: "+1 per food, poison not punished",
  survivor: "points for staying alive, nothing for eating",
};
// Reward sliders (Rey 2026-10-29): shares of three parts on one scale, so the shares mean what they say.
//   eat   = food eaten        / food the hand-written bot eats on this level
//   avoid = minus poison eaten / food the hand-written bot eats (same units as eat)
//   live  = share of the round survived (0..1)
// eat 50 / avoid 50 / live 0 is today's fixed reward (food - poison), only scaled: same ranking, same runs.
// When weights are set they replace the reward preset; they are scaled to add up to 1.
export interface Weights { eat: number; avoid: number; live: number }
export interface Settings { reward: Reward; mutation: number; pop: number; weights?: Weights; body?: BodyCard[] }
function weighted(s: Stats, w: Weights, botGood: number): number {
  const sum = w.eat + w.avoid + w.live || 1, we = w.eat / sum, wa = w.avoid / sum, wl = w.live / sum;
  // halves of whole numbers are exact, so at 50/50 equal food - poison gives exactly equal fitness
  return (we * s.good - wa * s.bad) / (botGood || 1) + (wl * s.life) / T;
}
export const DEFAULT_SETTINGS: Settings = { reward: "balanced", mutation: 0.3, pop: POP };
function fitness(s: Stats, r: Reward): number {
  return r === "balanced" ? s.score : r === "glutton" ? s.good : s.life / 40;
}

export const nIn = (b: Sense[]) => 3 + (b.includes("poison") ? 3 : 0) + (b.includes("taste") ? 1 : 0) + (b.includes("hunter") ? 3 : 0) + (b.includes("energy") ? 1 : 0) + (b.includes("neighbour") ? (EXPERIMENT.neighbourInfo ? 5 : 3) : 0) + (b.includes("terrain") ? TERRAIN_IN : 0) + (EXPERIMENT.thirst ? 2 : 0) + EXPERIMENT.memory;
export function gSize(nin: number, layers: number[], nout = 4): number {
  let s = 0, prev = nin;
  for (const h of [...layers, nout]) { s += prev * h + h; prev = h; }
  return s;
}
// Same arithmetic, same order as before; only the scratch arrays are reused (no garbage per tick).
// use (optional): outputs to work out; a skipped output is left as it was (an action the creature cannot take
// never needs its value, and skipping it changes no other number).
export function think(g: number[], inp: number[], layers: number[], out: number[], bufs: number[][], use?: boolean[]): void {
  let cur = inp, n = inp.length, k = 0;
  for (let l = 0; l < layers.length; l++) {
    const nxt = bufs[l], m = layers[l];
    for (let j = 0; j < m; j++) { let s = 0; for (let i = 0; i < n; i++) s += cur[i] * g[k++]; nxt[j] = tanh(s + g[k++]); }
    cur = nxt; n = m;
  }
  for (let j = 0; j < out.length; j++) {
    if (use && !use[j]) { k += n + 1; continue; }
    let s = 0; for (let i = 0; i < n; i++) s += cur[i] * g[k++]; out[j] = tanh(s + g[k++]);
  }
}
// Gap across the wrapped map, in -200..200. Was ((d + 600) % 400) - 200; for |d| < 400 the % only ever
// subtracts 0, 400 or 800, and those subtractions are exact in floating point, so this is bit-identical.
function wrap(d: number): number {
  let x = d + 1.5 * SIZE;
  if (x >= 2 * SIZE) x -= 2 * SIZE;
  else if (x >= SIZE) x -= SIZE;
  return x - SIZE / 2;
}

// Spatial grid (2026-10-30): the plate in 8 x 8 cells of 50 px. A search walks outward ring by ring and stops
// once no closer point can exist. Ties are broken by the lower index, exactly like the old scan of every
// bead, so every result is bit-identical (checked against recorded brute-force runs).
const CELL = 50, GN = SIZE / CELL;
const cellOf = (v: number) => (v / CELL) | 0; // = Math.floor for 0 <= v < 400, kept an integer (no slow float %)
class Grid {
  remove(id: number): void { const old = this.cell[id]; if (old === undefined) return; const b = this.buckets[old], k = b.indexOf(id); b[k] = b[b.length - 1]; b.pop(); this.cell[id] = undefined as unknown as number; }
  readonly cell: number[] = [];
  readonly buckets: number[][] = Array.from({ length: GN * GN }, () => []);
  set(id: number, x: number, y: number): void {
    const c = cellOf(x) + cellOf(y) * GN, old = this.cell[id];
    if (old === c) return;
    if (old !== undefined) { const b = this.buckets[old], k = b.indexOf(id); b[k] = b[b.length - 1]; b.pop(); }
    this.cell[id] = c; this.buckets[c].push(id);
  }
}
// RINGS[r] = cell offsets at ring r on the 8 x 8 wrapped grid, each cell once (ring 4 wraps onto itself).
const RINGS: number[][] = (() => {
  const seen = new Set<string>(), rings: number[][] = [];
  for (let r = 0; r <= GN / 2; r++) {
    const ring: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const k = `${(dx + GN) % GN},${(dy + GN) % GN}`;
      if (seen.has(k)) continue;
      seen.add(k); ring.push(dx, dy);
    }
    rings.push(ring);
  }
  return rings;
})();
// NEAR[r][c] = the cell numbers in ring r around cell c, worked out once (was: modulo arithmetic per cell per
// creature per tick, 21% of all time in the 2026-10-30 profile). Which cells are visited is unchanged.
const NEAR: Int32Array[][] = RINGS.map((ring) => Array.from({ length: GN * GN }, (_, c) => {
  const cx = c % GN, cy = (c / GN) | 0, out = new Int32Array(ring.length / 2);
  for (let q = 0; q < ring.length; q += 2) out[q / 2] = ((cx + ring[q] + GN) % GN) + ((cy + ring[q + 1] + GN) % GN) * GN;
  return out;
}));
// x % 400 for 0 <= x < 1200 without the slow float %: subtracting 400 or 800 here is exact (Sterbenz lemma).
const mod = (x: number) => (x >= 2 * SIZE ? x - 2 * SIZE : x >= SIZE ? x - SIZE : x);

// Direction and closeness of a point, written into the inputs at k (3 numbers; zeros when nothing is seen).
function toward(inp: number[], k: number, found: boolean, tx: number, ty: number, xi: number, yi: number, hxi: number, hyi: number, see: number): number {
  if (!found) { inp[k] = 0; inp[k + 1] = 0; inp[k + 2] = 0; return k + 3; }
  const dx = wrap(tx - xi), dy = wrap(ty - yi), d = Math.sqrt(dx * dx + dy * dy) || 1;
  inp[k] = (dx * hxi + dy * hyi) / d; inp[k + 1] = (-dx * hyi + dy * hxi) / d; inp[k + 2] = 1 - d / see;
  return k + 3;
}

export class World {
  t = 0;
  readonly r: Rng;
  readonly fx: number[] = []; readonly fy: number[] = []; readonly bad: boolean[] = [];
  readonly px: number[] = []; readonly py: number[] = []; readonly hx: number[] = []; readonly hy: number[] = [];
  readonly en: number[] = []; readonly taste: number[] = []; readonly alive: boolean[] = []; readonly act: number[] = [];
  readonly st: Stats[] = [];
  readonly kx: number[] = []; readonly ky: number[] = []; readonly kdx: number[] = []; readonly kdy: number[] = []; readonly rest: number[] = [];
  private readonly b: Sense[];
  private readonly inp: number[] = [];
  private readonly bufs: number[][];
  private readonly out: number[];
  private readonly use: boolean[]; // which actions this creature can take (an action needs its sense)
  private readonly eIdx: number = -1; private readonly tIdx: number = -1; private readonly fIdx: number = -1; private readonly tmIdx: number = -1; private readonly sIdx: number = -1; // extra outputs (experiments)
  private readonly ambush: boolean = false; private readonly burst: number[] = []; // sprinter's own threat
  private readonly toxin: boolean = false; private readonly tox: number[] = []; // scavenger's own threat
  private readonly tr8: Terrain | null = null; // terrain (test only)
  private readonly farmBead: boolean[] = []; private readonly off: boolean[] = []; private crowd = 0; // farm beads, eaten-and-waiting beads
  private readonly mem: number[] = []; private readonly memIdx: number = -1; // memory cells (flat: creature * M + cell)
  private readonly water: number[] = []; private readonly drIdx: number = -1; private readonly gwIdx: number = -1; // thirst
  private zoneHp = ZONE_HP; private zoneDown = 0; private readonly hDead: boolean[] = [];
  private readonly prevAct: number[] = []; private readonly catches: number[] = []; // neighbourInfo: last tick's moves; catches as x, y, tick
  private readonly stun: number[] = []; private readonly spitReady: boolean[] = []; // taste "spit"
  private readonly bx: number[] = []; private readonly by: number[] = []; private readonly bt: number[] = []; // taste "avoid": last poison bite

  readonly lv: Level; readonly rule: boolean; readonly layers: number[]; readonly genomes: number[][];

  readonly sp: Species;
  readonly body: Body;
  private readonly see: number;
  private readonly wk: number[][] | null = null; // working brains (learning in life)
  private readonly tr: number[][] | null = null;
  private readonly foodGrid = new Grid();
  private readonly preyGrid: Grid | null = null; // only when the See neighbour sense is used

  constructor(lv: Level, rule: boolean, build: Sense[], layers: number[], genomes: number[][], mapSeed: number, sp: Species = SPECIES[0], body?: Body) {
    this.sp = sp;
    this.body = body ?? makeBody(sp);
    this.see = SEE * this.body.seeMul * (lv.sight ?? 1);
    if (!rule && this.body.learn > 0) { this.wk = genomes.map((g) => g.slice()); this.tr = genomes.map((g) => new Array<number>(g.length).fill(0)); }
    this.lv = lv; this.rule = rule; this.layers = layers; this.genomes = genomes;
    const r = (this.r = createRng(mapSeed));
    for (let i = 0; i < lv.good + lv.bad; i++) { this.fx.push(r.next() * SIZE); this.fy.push(r.next() * SIZE); this.bad.push(i >= lv.good); }
    if (lv.terrain) {
      this.tr8 = lv.terrain;
      for (let i = 0; i < this.fx.length; i++) { this.farmBead.push(false); this.off.push(false); }
      const fm = lv.terrain.farm;
      if (fm) for (let i = 0; i < FARM_BEADS; i++) { const [x, y] = this.inFarm(fm); this.fx.push(x); this.fy.push(y); this.bad.push(false); this.farmBead.push(true); this.off.push(false); }
    }
    for (let i = 0; i < genomes.length; i++) {
      this.px.push(r.next() * SIZE); this.py.push(r.next() * SIZE);
      const a = r.next() * 2 * Math.PI; this.hx.push(cos(a)); this.hy.push(sin(a));
      this.en.push(1); this.taste.push(0); this.alive.push(true); this.act.push(3); this.st.push(newStats());
    }
    for (let i = 0; i < lv.hunters; i++) {
      this.kx.push(r.next() * SIZE); this.ky.push(r.next() * SIZE);
      const a = r.next() * 2 * Math.PI; this.kdx.push(cos(a)); this.kdy.push(sin(a)); this.rest.push(0);
    }
    this.b = rule ? lv.menu.filter((e) => e === "poison" || e === "hunter") : build;
    this.bufs = layers.map((m) => new Array<number>(m).fill(0));
    this.use = [true, this.b.includes("poison"), this.b.includes("hunter"), true];
    this.out = [0, 0, 0, 0];
    const extra = () => { this.use.push(true); return this.out.push(0) - 1; };
    if (!rule && EXPERIMENT.energyMove && this.b.includes("energy")) this.eIdx = extra();
    if (!rule && EXPERIMENT.tasteMove && this.b.includes("taste")) { this.tIdx = extra(); for (let i = 0; i < genomes.length; i++) { this.stun.push(0); this.spitReady.push(false); this.bx.push(0); this.by.push(0); this.bt.push(-1); } }
    if (!rule && EXPERIMENT.follow && this.b.includes("neighbour")) this.fIdx = extra();
    if (EXPERIMENT.ownThreats && sp.id === "sprinter") { this.ambush = true; for (let h = 0; h < lv.hunters; h++) this.burst.push(0); }
    if (EXPERIMENT.ownThreats && sp.id === "scavenger") { this.toxin = true; for (let i = 0; i < genomes.length; i++) this.tox.push(0); }
    if (!rule && EXPERIMENT.terrainMoves && this.b.includes("terrain")) { this.tmIdx = extra(); extra(); extra(); } // zone, farm, out of water
    if (EXPERIMENT.thirst) { for (let i = 0; i < genomes.length; i++) this.water.push(1); if (!rule) { if (EXPERIMENT.terrainMoves && this.b.includes("terrain")) this.gwIdx = extra(); } }
    if (!rule && this.body.sprint) this.sIdx = extra(); // sprint
    if (EXPERIMENT.memory > 0) { for (let i = 0; i < genomes.length * EXPERIMENT.memory; i++) this.mem.push(0); if (!rule) { this.memIdx = extra(); for (let m = 1; m < EXPERIMENT.memory; m++) extra(); } }
    for (let f = 0; f < this.fx.length; f++) this.foodGrid.set(f, this.fx[f], this.fy[f]);
    if (this.b.includes("neighbour")) { this.preyGrid = new Grid(); for (let i = 0; i < this.px.length; i++) this.preyGrid.set(i, this.px[i], this.py[i]); }
  }

  get done(): boolean { return this.t >= T; }
  private inFarm(fm: { x: number; y: number; r: number }): [number, number] { // a seeded spot inside the farm
    const a = this.r.next() * 2 * Math.PI, d = fm.r * Math.sqrt(this.r.next());
    return [mod(fm.x + d * cos(a) + SIZE), mod(fm.y + d * sin(a) + SIZE)];
  }
  private zoneUp(): boolean { return !!this.tr8?.zone && this.zoneDown === 0; }
  private wet(x: number, y: number): boolean { const rv = this.tr8?.river; return !!rv && Math.abs(riverOffset(rv, x, y)) < rv.width / 2; }

  step(): void {
    const { lv, r, fx, fy, bad, px, py, hx, hy, en, taste, alive, st, kx, ky, kdx, kdy, rest, inp, out } = this;
    const n = px.length;
    const needPoison = (this.rule || this.b.includes("poison")) && lv.bad > 0;
    const hasP = this.b.includes("poison"), hasT = this.b.includes("taste"), hasH = this.b.includes("hunter"), hasE = this.b.includes("energy"), hasN = this.b.includes("neighbour");
    const nbInfo = hasN && EXPERIMENT.neighbourInfo && !this.rule;
    if (nbInfo) for (let i = 0; i < n; i++) this.prevAct[i] = this.act[i];
    let ni = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      st[i].life++;
      if (this.tIdx >= 0 && this.stun[i] > 0) { // spitting: stands still, can't act
        this.stun[i]--; en[i] -= HUNGER * this.body.hunger;
        if (en[i] <= 0) { alive[i] = false; st[i].starved = 1; }
        continue;
      }
      const see = this.see;
      let fi = -1, fd = see * see, pi = -1, pd = see * see, hi = -1, hd = see * see;
      const xi = px[i], yi = py[i];
      { // nearest bead and nearest poison: rings of cells outward (inlined for speed)
        // nearest poison is only used by the poison sense and the bot; otherwise don't search for it
        if (!needPoison) pd = 0;
        const c0 = cellOf(xi) + cellOf(yi) * GN, buckets = this.foodGrid.buckets;
        for (let rr = 0; rr < NEAR.length; rr++) {
          if (rr >= 1) { const lb = (rr - 1) * CELL, lim = fd > pd ? fd : pd; if (lb * lb >= lim) break; }
          const cells = NEAR[rr][c0];
          for (let q = 0; q < cells.length; q++) {
            const b = buckets[cells[q]];
            for (let m = 0; m < b.length; m++) {
              const f = b[m];
              const dx = wrap(fx[f] - xi), dx2 = dx * dx;
              if (dx2 > fd && (!bad[f] || dx2 > pd)) continue; // too far sideways to beat or tie either record
              const dy = wrap(fy[f] - yi), d = dx2 + dy * dy;
              if (d < fd || (d === fd && f < fi)) { fd = d; fi = f; }
              if (needPoison && bad[f] && (d < pd || (d === pd && f < pi))) { pd = d; pi = f; }
            }
          }
        }
      }
      for (let h = 0; h < lv.hunters; h++) {
        if (this.ambush && this.burst[h] === 0) continue; // hidden in ambush: can't be seen
        if (this.tr8 && this.hDead[h]) continue; // drowned
        const dx = wrap(kx[h] - px[i]), dx2 = dx * dx;
        if (dx2 >= hd) continue;
        const dy = wrap(ky[h] - py[i]), d = dx2 + dy * dy;
        if (d < hd) { hd = d; hi = h; }
      }
      const hxi = hx[i], hyi = hy[i];
      let k = toward(inp, 0, fi >= 0, fi >= 0 ? fx[fi] : 0, fi >= 0 ? fy[fi] : 0, xi, yi, hxi, hyi, see);
      if (hasP) k = toward(inp, k, pi >= 0, pi >= 0 ? fx[pi] : 0, pi >= 0 ? fy[pi] : 0, xi, yi, hxi, hyi, see);
      if (hasT) inp[k++] = taste[i];
      if (hasH) k = toward(inp, k, hi >= 0, hi >= 0 ? kx[hi] : 0, hi >= 0 ? ky[hi] : 0, xi, yi, hxi, hyi, see);
      if (hasE) inp[k++] = en[i] - 1;
      if (this.b.includes("terrain")) { // See terrain: river side + in water, farm and zone direction and closeness
        const t8 = this.tr8, rv = t8?.river;
        if (rv) { const o = riverOffset(rv, xi, yi); inp[k++] = o > 100 ? 1 : o < -100 ? -1 : o / 100; inp[k++] = Math.abs(o) < rv.width / 2 ? 1 : 0; } else { inp[k++] = 0; inp[k++] = 0; }
        for (const c of [t8?.farm ?? null, this.zoneUp() ? t8!.zone : null]) {
          if (!c) { inp[k++] = 0; inp[k++] = 0; inp[k++] = 0; continue; }
          const dx = wrap(c.x - xi), dy = wrap(c.y - yi), d = Math.sqrt(dx * dx + dy * dy) || 1;
          inp[k++] = (dx * hxi + dy * hyi) / d; inp[k++] = (-dx * hyi + dy * hxi) / d; inp[k++] = d < 200 ? 1 - d / 200 : 0;
        }
      }
      if (hasN && this.preyGrid) { // nearest other living creature (crowding: the lab measured +6.8 food from this sense)
        let nd = see * see; ni = -1;
        const c0 = cellOf(xi) + cellOf(yi) * GN, buckets = this.preyGrid.buckets;
        for (let rr = 0; rr < NEAR.length; rr++) {
          if (rr >= 1) { const lb = (rr - 1) * CELL; if (lb * lb >= nd) break; }
          const cells = NEAR[rr][c0];
          for (let q = 0; q < cells.length; q++) {
            const b = buckets[cells[q]];
            for (let m = 0; m < b.length; m++) {
              const j = b[m];
              if (j === i || !alive[j]) continue;
              const dx = wrap(px[j] - xi), dx2 = dx * dx;
              if (dx2 > nd) continue;
              const dy = wrap(py[j] - yi), d = dx2 + dy * dy;
              if (d < nd || (d === nd && j < ni)) { nd = d; ni = j; }
            }
          }
        }
        k = toward(inp, k, ni >= 0, ni >= 0 ? px[ni] : 0, ni >= 0 ? py[ni] : 0, xi, yi, hxi, hyi, see);
        if (nbInfo) {
          inp[k++] = ni >= 0 && this.prevAct[ni] === 2 ? 1 : 0; // my neighbour fled last tick
          let alarm = 0;
          for (let c = 0; c < this.catches.length; c += 3) {
            if (this.t - this.catches[c + 2] > ALARM_T) continue;
            const dx = wrap(this.catches[c] - xi), dy = wrap(this.catches[c + 1] - yi);
            if (dx * dx + dy * dy < ALARM_R * ALARM_R) { alarm = 1; break; }
          }
          inp[k++] = alarm;
        }
      }
      if (EXPERIMENT.thirst) { inp[k++] = this.water[i] - 1; inp[k++] = this.wet(xi, yi) ? 1 : 0; } // innate: thirst, wet
      for (let m = 0; m < EXPERIMENT.memory; m++) inp[k++] = this.mem[i * EXPERIMENT.memory + m]; // last tick's memory
      if (inp.length !== k) inp.length = k; // (setting length every tick cost 3%)
      let act = 3;
      if (this.rule) {
        if (EXPERIMENT.thirst && this.tr8?.river && this.water[i] < BOT_THIRSTY) act = this.wet(xi, yi) ? 10 : 11; // the bot drinks too
        else if (hi >= 0 && hd < FLEE_AT * FLEE_AT) act = 2;
        else if (fi >= 0 && fi === pi && this.sp.goal !== "eaten") act = 1; // a scavenger's bot swallows poison too
        else act = 0;
      } else {
        think(this.wk ? this.wk[i] : this.genomes[i], inp, this.layers, out, this.bufs, this.tr ? undefined : this.use);
        if (this.tr) traceStep(this.tr[i], inp, this.layers, this.bufs, out);
        if (this.memIdx >= 0) for (let m = 0; m < EXPERIMENT.memory; m++) this.mem[i * EXPERIMENT.memory + m] = out[this.memIdx + m]; // remember for next tick
        let best = -2;
        for (let a = 0; a < 4; a++) {
          if ((a === 1 && !hasP) || (a === 2 && !hasH)) continue; // an action needs its sense
          if (out[a] > best) { best = out[a]; act = a; }
        }
        if (this.eIdx >= 0 && out[this.eIdx] > best) { best = out[this.eIdx]; act = 4; }
        if (this.tIdx >= 0 && out[this.tIdx] > best) { best = out[this.tIdx]; act = 5; }
        if (this.fIdx >= 0 && out[this.fIdx] > best) { best = out[this.fIdx]; act = 6; }
        if (this.tmIdx >= 0) for (let q = 0; q < 3; q++) if (out[this.tmIdx + q] > best) { best = out[this.tmIdx + q]; act = 7 + q; }
        if (this.drIdx >= 0 && out[this.drIdx] > best) { best = out[this.drIdx]; act = 10; }
        if (this.gwIdx >= 0 && out[this.gwIdx] > best) { best = out[this.gwIdx]; act = 11; }
      }
      this.act[i] = act;
      // face a point (or away from it), else wander: a small random turn (no closures: this runs per creature per tick)
      let fdx = 0, fdy = 0, faced = true;
      if (act === 0 && fi >= 0) { fdx = wrap(fx[fi] - xi); fdy = wrap(fy[fi] - yi); }
      else if (act === 1 && pi >= 0) { fdx = -wrap(fx[pi] - xi); fdy = -wrap(fy[pi] - yi); }
      else if (act === 2 && hi >= 0) { fdx = -wrap(kx[hi] - xi); fdy = -wrap(ky[hi] - yi); }
      else if (act === 6 && ni >= 0) { fdx = wrap(px[ni] - xi); fdy = wrap(py[ni] - yi); }
      else if (act === 7 && this.zoneUp()) { fdx = wrap(this.tr8!.zone!.x - xi); fdy = wrap(this.tr8!.zone!.y - yi); }
      else if (act === 8 && this.tr8?.farm) { fdx = wrap(this.tr8.farm.x - xi); fdy = wrap(this.tr8.farm.y - yi); }
      else if (act === 11 && this.tr8?.river && !this.wet(xi, yi)) { fdx = 0; fdy = riverOffset(this.tr8.river, xi, yi) >= 0 ? -1 : 1; } // head for the water
      else if (act === 9 && this.tr8?.river && this.wet(xi, yi)) { fdx = 0; fdy = riverOffset(this.tr8.river, xi, yi) >= 0 ? 1 : -1; } // straight out of the water
      else if (act === 5 && EXPERIMENT.tasteMove === "avoid" && this.bt[i] >= 0 && this.t - this.bt[i] <= AVOID_MEMORY) { fdx = -wrap(this.bx[i] - xi); fdy = -wrap(this.by[i] - yi); }
      else faced = false;
      let still = false, half = false; // energy move: rest = still, slow = half speed; both half hunger
      if (EXPERIMENT.thirst && this.tr8?.river && this.wet(xi, yi)) this.water[i] = Math.min(1, this.water[i] + DRINK); // drinks while in the water
      if (act === 10) still = true; // the bot stands still to drink
      if (act === 4) { half = true; still = EXPERIMENT.energyMove === "rest"; }
      if (act === 5 && EXPERIMENT.tasteMove === "spit" && this.spitReady[i]) { // spit: half the poison damage back, then stand still
        en[i] = Math.min(this.body.emax, en[i] + 0.5 * POISON * this.body.poisonHurt); this.spitReady[i] = false; this.stun[i] = SPIT_STUN; still = true;
      }
      if (faced) { const d = Math.sqrt(fdx * fdx + fdy * fdy) || 1; hx[i] = fdx / d; hy[i] = fdy / d; }
      else if (!still) { const a = r.gauss() * 0.2, c = cos(a), s = sin(a), x = hxi; hx[i] = x * c - hyi * s; hy[i] = x * s + hyi * c; }
      const sprinting = this.sIdx >= 0 && out[this.sIdx] > 0;
      const spd0 = still ? 0 : half ? this.body.speed * 0.5 : sprinting ? this.body.speed * this.body.sprint : this.body.speed;
      const spd = this.tr8 && this.wet(xi, yi) ? spd0 * RIVER_SLOW : spd0;
      if (!still) { px[i] = mod(px[i] + hx[i] * spd + SIZE); py[i] = mod(py[i] + hy[i] * spd + SIZE); }
      if (this.tr8?.river && this.wet(px[i], py[i]) && r.next() < DROWN) { alive[i] = false; continue; } // drowned
      if (this.tr8?.farm && inCircle(this.tr8.farm, px[i], py[i])) this.crowd++;
      if (this.preyGrid) this.preyGrid.set(i, px[i], py[i]);
      if (fi >= 0 && !(this.tr8 && this.off[fi])) {
        const dx = wrap(fx[fi] - px[i]), dy = wrap(fy[fi] - py[i]);
        if (dx * dx + dy * dy < BITE * BITE) {
          if (bad[fi]) { en[i] -= POISON * this.body.poisonHurt; st[i].bad++; st[i].score--; taste[i] = 1; }
          else { en[i] = Math.min(this.body.emax, en[i] + this.body.meal); st[i].good++; st[i].score++; taste[i] = -1; }
          if (this.toxin && bad[fi]) this.tox[i] += 1;
          if (this.tIdx >= 0) { this.spitReady[i] = bad[fi]; if (bad[fi]) { this.bx[i] = fx[fi]; this.by[i] = fy[fi]; this.bt[i] = this.t; } }
          if (this.wk && this.tr) en[i] -= LEARN_COST * learnFrom(this.wk[i], this.tr[i], this.body.learn * (bad[fi] ? -1 : 1));
          if (this.tr8 && this.farmBead[fi]) { this.off[fi] = true; this.foodGrid.remove(fi); } // waits for the next ripening
          else {
            fx[fi] = r.next() * SIZE; fy[fi] = r.next() * SIZE;
            if (this.tr8?.zone) while (inCircle(this.tr8.zone, fx[fi], fy[fi])) { fx[fi] = r.next() * SIZE; fy[fi] = r.next() * SIZE; } // no food in the safe zone
            this.foodGrid.set(fi, fx[fi], fy[fi]);
          }
        }
      }
      let hm = this.body.hunger;
      if (sprinting) hm = hm * this.body.sprint * this.body.sprint;
      if (half) hm = hm * 0.5;
      en[i] -= HUNGER * hm;
      if (EXPERIMENT.thirst && this.tr8?.river) { this.water[i] -= 1 / THIRST_T; if (this.water[i] <= 0) { alive[i] = false; st[i].starved = 1; continue; } } // died of thirst
      if (this.toxin) { const t = this.tox[i] > DETOX ? this.tox[i] - DETOX : 0; this.tox[i] = t; if (t > TOX_FREE) en[i] -= TOX_HARM * (t - TOX_FREE); }
      if (en[i] <= 0) { alive[i] = false; st[i].starved = 1; }
    }
    for (let h = 0; h < lv.hunters; h++) {
      if (this.tr8 && this.hDead[h]) continue; // drowned
      if (rest[h] > 0) { rest[h]--; continue; }
      const hiding = this.ambush && this.burst[h] === 0;
      let ti = -1, td = hiding ? AMBUSH_R * AMBUSH_R : HUNT_SEE * HUNT_SEE;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const dx = wrap(px[i] - kx[h]), dx2 = dx * dx;
        if (dx2 >= td) continue;
        const dy = wrap(py[i] - ky[h]), d = dx2 + dy * dy;
        if (d < td) { td = d; ti = i; }
      }
      if (this.ambush) { // wait still and hidden; burst when prey comes close; hide again when the burst ends
        if (ti < 0) { this.burst[h] = 0; continue; }
        if (hiding) this.burst[h] = BURST_T; else this.burst[h]--;
      }
      let sp = 1;
      if (ti >= 0) {
        const dx = wrap(px[ti] - kx[h]), dy = wrap(py[ti] - ky[h]), d = Math.sqrt(dx * dx + dy * dy) || 1;
        kdx[h] = dx / d; kdy[h] = dy / d; sp = this.ambush ? AMBUSH_SPEED : HUNTER_SPEED;
        if (d < CATCH) {
          let crowd = 0;
          if (EXPERIMENT.confusion) for (let j = 0; j < n && crowd < CONF_N; j++) {
            if (j === ti || !alive[j]) continue;
            const ex = wrap(px[j] - px[ti]), ey = wrap(py[j] - py[ti]);
            if (ex * ex + ey * ey < CONF_R * CONF_R) crowd++;
          }
          if (crowd >= CONF_N) { rest[h] = CONF_REST; continue; } // confused by the group: the catch fails
          alive[ti] = false; st[ti].hunted = 1; rest[h] = REST;
          if (this.ambush) this.burst[h] = 0;
          if (EXPERIMENT.neighbourInfo) this.catches.push(px[ti], py[ti], this.t);
          continue;
        }
      } else if (this.tr8?.farm && this.tr8.raid && !inCircle({ ...this.tr8.farm, r: this.tr8.farm.r + 30 }, kx[h], ky[h])) { // patrol: head back to the farm's edge
        const dx = wrap(this.tr8.farm.x - kx[h]), dy = wrap(this.tr8.farm.y - ky[h]), d = Math.sqrt(dx * dx + dy * dy) || 1; kdx[h] = dx / d; kdy[h] = dy / d;
      } else { const a = r.gauss() * 0.2, c = cos(a), s = sin(a), x = kdx[h]; kdx[h] = x * c - kdy[h] * s; kdy[h] = x * s + kdy[h] * c; }
      if (this.tr8) {
        if (this.wet(kx[h], ky[h])) sp *= RIVER_SLOW;
        const nx = mod(kx[h] + kdx[h] * sp + SIZE), ny = mod(ky[h] + kdy[h] * sp + SIZE);
        if (this.zoneUp() && !inCircle(this.tr8.zone!, kx[h], ky[h]) && inCircle(this.tr8.zone!, nx, ny)) { // the safe zone keeps hunters out; pushing at it while chasing wears it down
          if (ti >= 0 && --this.zoneHp <= 0) { this.zoneDown = ZONE_DOWN; this.zoneHp = ZONE_HP; }
          continue;
        }
        kx[h] = nx; ky[h] = ny;
        if (this.tr8.river && this.wet(nx, ny) && r.next() < DROWN) this.hDead[h] = true;
        continue;
      }
      kx[h] = mod(kx[h] + kdx[h] * sp + SIZE); ky[h] = mod(ky[h] + kdy[h] * sp + SIZE);
    }
    if (this.tr8) {
      if (this.zoneDown > 0) this.zoneDown--;
      const fm = this.tr8.farm;
      if (fm && (this.t + 1) % RIPEN === 0) { // ripening wave: fewer beads ripen the more crowded the farm was (overgrazing)
        let ripe = Math.round((FARM_BEADS * CROWD_K) / (CROWD_K + this.crowd / RIPEN));
        for (let f = 0; f < fx.length && ripe > 0; f++) if (this.farmBead[f] && this.off[f]) { [fx[f], fy[f]] = this.inFarm(fm); this.off[f] = false; this.foodGrid.set(f, fx[f], fy[f]); ripe--; }
        this.crowd = 0;
      }
    }
    this.t++;
  }
}

// Input order is fixed: food(3) poison(3) taste(1) hunter(3) energy(1), only the chosen senses present.
const INPUT_ORDER: [string, number][] = [["food", 3], ["poison", 3], ["taste", 1], ["hunter", 3], ["energy", 1], ["terrain", TERRAIN_IN], ["neighbour", 3]]; // terrain inputs come before neighbour (step() order)
const inputKeys = (b: Sense[]) => [...INPUT_ORDER, ["thirst", 2] as [string, number], ["mem", EXPERIMENT.memory] as [string, number]].flatMap(([s, n]) => (s === "food" || b.includes(s as Sense) || (s === "thirst" && EXPERIMENT.thirst) || (s === "mem" && n > 0) ? Array.from({ length: n }, (_, i) => s + i) : []));
// Re-wire the first layer from one set of senses to another: kept inputs keep their weights, new ones get 0,
// dropped ones are removed. Deeper layers are unchanged.
export function expandGenome(g: number[], from: Sense[], to: Sense[], layers: number[]): number[] {
  const a = inputKeys(from), map = inputKeys(to).map((k) => a.indexOf(k));
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j < layers[0]; j++) {
    const w = g.slice(k, k + a.length); k += a.length;
    const bias = g[k++];
    for (const m of map) out.push(m < 0 ? 0 : w[m]);
    out.push(bias);
  }
  for (; k < g.length; k++) out.push(g[k]);
  return out;
}

export function episode(lv: Level, rule: boolean, build: Sense[], layers: number[], genomes: number[][], mapSeed: number, sp: Species = SPECIES[0], body?: Body): Stats[] {
  const w = new World(lv, rule, build, layers, genomes, mapSeed, sp, body);
  while (!w.done) w.step();
  return w.st;
}

export function mean(st: Stats[]): Stats {
  const m = newStats();
  for (const s of st) { m.score += s.score; m.good += s.good; m.bad += s.bad; m.hunted += s.hunted; m.starved += s.starved; m.life += s.life; }
  for (const key of Object.keys(m) as (keyof Stats)[]) m[key] /= st.length;
  return m;
}

// One brain (cloned for the whole population) on the 2 maps evolution never trains on.
// The bot's score depends only on the level and species (it ignores build, brains and body cards), so it is
// worked out once per level and kept: every run on the same level and species reuses it.
const botCache = new Map<string, Stats>();
export function heldOut(lv: Level, rule: boolean, build: Sense[], layers: number[], g: number[], sp: Species = SPECIES[0], body?: Body): Stats {
  if (rule && !body) {
    const k = `${sp.id}|${JSON.stringify(lv)}`;
    let st = botCache.get(k);
    if (!st) { st = heldOutRaw(lv, true, build, layers, g, sp); botCache.set(k, st); }
    return { ...st };
  }
  return heldOutRaw(lv, rule, build, layers, g, sp, body);
}
function heldOutRaw(lv: Level, rule: boolean, build: Sense[], layers: number[], g: number[], sp: Species, body?: Body): Stats {
  const all: Stats[] = [];
  for (const s of HELD) all.push(...episode(lv, rule, build, layers, Array.from({ length: POP }, () => g), s, sp, body));
  return mean(all);
}

// Evolution, one generation per call. Same rules as proto/tune.ts run().
export class Evolver {
  gen = 0;
  readonly hist: number[] = []; // progress every EVERY generations
  pop: number[][];
  // Families (Rey 2026-10-30, "evolution is blind, you are not" test): fam[i] = the founder brain pop[i] descends
  // from. favour = the player backs a family: that share of the parents comes from its best members. Tracking
  // families draws no random numbers, so with favour unset every run is unchanged.
  fam: number[] = [];
  favour: { fam: number; share: number } | null = null;
  lastFit: number[] = []; // fitness of the last generation's brains, in pop order (tests)
  // Islands (tests, 2026-10-30): with islands = k the population breeds in k separate groups (fam = island), so k
  // lines always survive; favour then gives the backed island share x the whole population's places.
  islands = 0;
  champ: number[] | null = null;
  champStats: Stats | null = null;
  ruleStats: Stats;
  private readonly er: Rng;

  lv: Level; build: Sense[]; readonly layers: number[]; readonly seed: number;

  set: Settings; // the player may change the reward (and gain body cards) between stages
  readonly sp: Species;
  // Powers: change only the training world for a few generations; the test maps never change.
  private effects: { kind: AnyPower; from: number; until: number }[] = [];
  // Tests only: skip checks before this generation (they never change evolution, only the progress shown).
  checkAfter = 0;
  private stageStart = 0; private legsSince = -1; // experiments: stage's first generation, generation legs was picked
  usePower(kind: AnyPower): void { this.effects.push({ kind, from: this.gen + 1, until: this.gen + powerGens(kind) }); }
  activePowers(gen = this.gen + 1): AnyPower[] { return this.effects.filter((e) => gen <= e.until).map((e) => e.kind); }

  constructor(lv: Level, build: Sense[], layers: number[], seed: number, set: Settings = DEFAULT_SETTINGS, sp: Species = SPECIES[0]) {
    if (EXPERIMENT.terrain.length) lv = { ...lv, terrain: makeTerrain(seed, EXPERIMENT.terrain) };
    this.lv = lv; this.build = build; this.layers = layers; this.seed = seed; this.set = set; this.sp = sp;
    this.er = createRng(seed * 7919 + 13);
    this.ruleStats = heldOut(lv, true, build, layers, [], sp);
    const nin = nIn(build), size = gSize(nin, layers, nOut(build, makeBody(sp, set.body ?? [])));
    this.pop = Array.from({ length: set.pop }, () => Array.from({ length: size }, () => this.er.gauss() * 0.5));
    if (EXPERIMENT.zeroSenses) for (const g of this.pop) for (let j = 0; j < layers[0]; j++) for (let i = 3; i < nin; i++) g[j * (nin + 1) + i] = 0; // T1
  }

  // Roguelite runs (Rey 2026-10-29): the same species moves on to the next stage. Its brains keep what
  // they learned; inputs for newly added senses start at weight 0 (the brain ignores them until evolution
  // finds a use). Changes no random numbers, so a run is still fully set by its seed and choices.
  nextStage(lv: Level, build: Sense[]): void {
    this.pop = this.pop.map((g) => expandGenome(g, this.build, build, this.layers));
    if (EXPERIMENT.terrain.length) lv = { ...lv, terrain: makeTerrain(this.seed, EXPERIMENT.terrain) };
    this.lv = lv; this.build = build; this.stageStart = this.gen;
    this.ruleStats = heldOut(lv, true, build, this.layers, [], this.sp);
    this.champ = null; this.champStats = null;
  }

  // One generation as small pieces: yields every SLICE ticks so a page can draw in between, and returns
  // the new progress when this generation was a check (else null). step() runs it straight through.
  *generation(): Generator<void, number | null> {
    const gen = this.gen + 1, er = this.er;
    if (EXPERIMENT.legsGrow > 0 && (this.set.body ?? []).includes("legs") && this.legsSince < 0) this.legsSince = this.gen;
    const body = makeBody(this.sp, this.set.body ?? [], this.legsSince < 0 ? 0 : gen - this.legsSince);
    if (EXPERIMENT.farmRaid > 0 && this.lv.terrain?.farm && !this.lv.terrain.raid && gen - this.stageStart > EXPERIMENT.farmRaid) { // the disaster arrives
      this.lv = { ...this.lv, terrain: { ...this.lv.terrain, raid: true } };
      this.ruleStats = heldOut(this.lv, true, this.build, this.layers, [], this.sp); // the bot faces it too
    }
    const on = this.activePowers(gen);
    let trainLv = this.lv;
    if (on.includes("food")) trainLv = { ...trainLv, good: Math.round(trainLv.good * 1.5) };
    if (on.includes("shelter")) trainLv = { ...trainLv, hunters: 0 };
    const threat = (lv: Level, x: number): Level => ({ ...lv, bad: Math.round(lv.bad * x), hunters: Math.round(lv.hunters * x) });
    if (on.includes("hard") || on.includes("hardlong")) trainLv = threat(trainLv, 2);
    const sw = this.effects.find((e) => e.kind === "switch" && gen >= e.from && gen <= e.until);
    if (sw) trainLv = threat(trainLv, Math.floor((gen - sw.from) / 2) % 2 === 0 ? 0 : 2);
    if (on.includes("dark")) trainLv = { ...trainLv, sight: (trainLv.sight ?? 1) * 0.6 };
    const w = new World(trainLv, false, this.build, this.layers, this.pop, this.seed * 1000 + gen, this.sp, body);
    while (!w.done) { w.step(); if (w.t % SLICE === 0) yield; }
    this.gen = gen;
    const st = w.st;
    const rw = this.set.reward;
    const ws = this.set.weights, bg = this.ruleStats.good;
    const fit = st.map((x) => (ws ? weighted(x, ws, bg) : fitness(x, rw)));
    const order = this.pop.map((_, i) => i).sort((a, b) => fit[b] - fit[a] || a - b);
    let p: number | null = null;
    if (gen % EVERY === 0 && gen > this.checkAfter) {
      const champ = this.pop[order[0]].slice();
      const all: Stats[] = [];
      for (const s of HELD) {
        const hw = new World(this.lv, false, this.build, this.layers, Array.from({ length: POP }, () => champ), s, this.sp, body);
        while (!hw.done) { hw.step(); if (hw.t % SLICE === 0) yield; }
        all.push(...hw.st);
      }
      this.champ = champ;
      this.champStats = mean(all);
      p = goalValue(this.champStats, this.sp.goal) / goalValue(this.ruleStats, this.sp.goal); // clean: food - poison, as before
      this.hist.push(p);
    }
    // top fifth are parents, top tenth are kept unchanged (6 and 3 at the default 30)
    let np = Math.round(this.pop.length / 5), ne = Math.round(this.pop.length / 10), mu = this.set.mutation;
    if (on.includes("burst")) mu *= 3;
    if (on.includes("cull")) { np = Math.min(np, 3); ne = Math.min(ne, np); }
    if (this.islands > 0) { // each island breeds on its own: its best fifth are parents, its best tenth kept unchanged
      const k = this.islands, n = this.pop.length;
      if (this.fam.length !== n) this.fam = this.pop.map((_, i) => Math.floor((i * k) / n));
      const places = Array.from({ length: k }, (_, I) => Math.floor(((I + 1) * n) / k) - Math.floor((I * n) / k));
      if (this.favour) { const big = Math.round(n * this.favour.share), rest = n - big; for (let I = 0, o = 0; I < k; I++) places[I] = I === this.favour.fam ? big : Math.floor(((o + 1) * rest) / (k - 1)) - Math.floor((o++ * rest) / (k - 1)); }
      const next: number[][] = [], nfam: number[] = [];
      for (let I = 0; I < k; I++) {
        const mine = order.filter((i) => this.fam[i] === I);
        if (!mine.length) continue;
        const inp = Math.max(1, Math.round(mine.length / 5)), ine = Math.max(1, Math.round(mine.length / 10));
        const par = mine.slice(0, inp).map((i) => this.pop[i]);
        for (let c = 0; c < places[I]; c++) { nfam.push(I); next.push(c < ine ? par[c % inp].slice() : par[c % inp].map((x) => (er.next() < 0.2 ? x + er.gauss() * mu : x))); }
      }
      this.lastFit = fit;
      this.pop = next; this.fam = nfam;
      return p;
    }
    if (this.fam.length !== this.pop.length) this.fam = this.pop.map((_, i) => i);
    let pick = order.slice(0, np);
    if (this.favour) { // the backed family supplies its share of the parents (its best first), the rest are the overall best
      const fv = this.favour, mine = order.filter((i) => this.fam[i] === fv.fam).slice(0, Math.round(np * fv.share));
      if (mine.length) pick = [...mine, ...order.filter((i) => !mine.includes(i))].slice(0, np);
    }
    const parents = pick.map((i) => this.pop[i]), pfam = pick.map((i) => this.fam[i]);
    const next = parents.slice(0, ne).map((g) => g.slice()), nfam = pfam.slice(0, ne);
    while (next.length < this.pop.length) { nfam.push(pfam[next.length % np]); next.push(parents[next.length % np].map((x) => (er.next() < 0.2 ? x + er.gauss() * mu : x))); }
    this.lastFit = fit;
    this.pop = next; this.fam = nfam;
    return p;
  }

  // An independent copy of this evolution at this point (tests: run gens 0-29 once, then branch per power).
  // Copies the random number state too, so the copy goes on exactly as this one would.
  fork(): Evolver {
    const c = Object.create(Evolver.prototype) as Evolver;
    Object.assign(c, this, {
      hist: this.hist.slice(), pop: this.pop.map((g) => g.slice()), champ: this.champ?.slice() ?? null, fam: this.fam.slice(), favour: this.favour && { ...this.favour }, lastFit: this.lastFit.slice(),
      champStats: this.champStats && { ...this.champStats }, ruleStats: { ...this.ruleStats },
      er: this.er.fork(), set: { ...this.set }, effects: this.effects.map((e) => ({ ...e })), build: this.build.slice(),
    });
    return c;
  }

  step(): number | null {
    const it = this.generation();
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
}

// One sentence: why is this brain behind the rule bot? (Port of learn-game.ts why(), taste fixed.)
export function why(lv: Level, build: Sense[], c: Stats, b: Stats, progress: number, w: Weights = { eat: 1, avoid: 1, live: 0 }): string {
  if (progress >= BAR) return progress >= 1 ? "Beats the hand-written bot." : "Close to the hand-written bot: level passed.";
  // the reward itself is the problem (measured traps: avoid only, live only, avoid + live)
  const sum = w.eat + w.avoid + w.live || 1, we = w.eat / sum, wa = w.avoid / sum, wl = w.live / sum;
  // under 20% eating failed in every measured case; 20-35% only when they actually stopped eating
  if (we < 0.2 || (c.good < 0.4 * b.good && we < 0.35))
    return wl > wa ? "Your reward pays for staying alive, not for eating, so they learned to keep away from everything."
      : "Your reward pays for not eating poison, so they learned not to eat at all.";
  if (c.bad > b.bad + 0.5 && wa < 0.35 && build.includes("poison"))
    return "Your reward barely punishes poison, so they eat it even though they can see it.";
  if (lv.hunters > 0 && c.hunted > b.hunted + 0.1)
    return build.includes("hunter") ? "Sees hunters but hasn't learned to flee yet. Give it more generations." : "Your creatures can't see hunters, so they can't learn to flee them.";
  if (c.bad > b.bad + 0.5) {
    if (build.includes("poison")) return "Sees poison but hasn't learned to avoid it yet. Give it more generations.";
    if (build.includes("taste")) return "Taste only tells after the bite. These brains can't learn during life, so taste can't help.";
    return "Your creatures can't tell poison from food, so they eat both.";
  }
  if (c.starved > b.starved + 0.1) return "Starving: hasn't learned to find food yet.";
  return "Eats too slowly: still learning.";
}

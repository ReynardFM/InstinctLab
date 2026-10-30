// Learning-game world, one tick at a time (the page watches it; evolution runs it flat out).
// Same arithmetic and random-number order as proto/tune.ts, so the page reproduces the measured numbers.
import { sin, cos, tanh } from "../../src/engine/dmath.ts";
import { createRng, type Rng } from "../../src/engine/rng.ts";

export const SIZE = 400, T = 800, POP = 30, EVERY = 5, HELD = [101, 102], BAR = 0.8;
const SLICE = 40; // ticks between pauses when evolution shares the page with drawing
const SEE = 150, FLEE_AT = 60, BITE = 6, CATCH = 8, HUNTER_SPEED = 1.9, REST = 20, HUNT_SEE = 120;
const HUNGER = 0.0015, MEAL = 0.3, POISON = 0.35, EMAX = 1.5;

export type Sense = "poison" | "taste" | "hunter" | "energy" | "neighbour";
export interface Level { id: string; name: string; good: number; bad: number; hunters: number; menu: Sense[]; blurb: string; sight?: number }

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
  legs: { name: "Long legs", gain: "+15% speed", cost: "+50% hunger" },
  eyes: { name: "Sharp eyes", gain: "sees 33% further", cost: "+15% hunger" },
  stomach: { name: "Tough stomach", gain: "poison hurts 50% less", cost: "food gives 20% less" },
  belly: { name: "Big belly", gain: "stores 50% more energy", cost: "+10% hunger" },
};
export interface Body { speed: number; hunger: number; poisonHurt: number; meal: number; emax: number; seeMul: number; learn: number }
const LEARN_DECAY = 0.9, LEARN_COST = 0.002;
// Species body times the cards (multiplying by nothing keeps today's numbers exactly).
export function makeBody(sp: Species, cards: BodyCard[] = []): Body {
  const b: Body = { speed: sp.speed, hunger: sp.hunger, poisonHurt: sp.poisonHurt, meal: MEAL, emax: EMAX, seeMul: 1, learn: 0 };
  // Round 1 of the exhaustive test (2026-10-29): speed decided almost everything (legs top in 10/10,
  // speed-cost cards at the bottom), learning in life dead. Rey's call (c): costs move to hunger.
  if (cards.includes("legs")) { b.speed *= 1.15; b.hunger *= 1.5; }
  if (cards.includes("eyes")) { b.seeMul *= 200 / 150; b.hunger *= 1.15; }
  if (cards.includes("stomach")) { b.poisonHurt *= 0.5; b.meal *= 0.8; }
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

export const nIn = (b: Sense[]) => 3 + (b.includes("poison") ? 3 : 0) + (b.includes("taste") ? 1 : 0) + (b.includes("hunter") ? 3 : 0) + (b.includes("energy") ? 1 : 0) + (b.includes("neighbour") ? 3 : 0);
export function gSize(nin: number, layers: number[], nout = 4): number {
  let s = 0, prev = nin;
  for (const h of [...layers, nout]) { s += prev * h + h; prev = h; }
  return s;
}
// Same arithmetic, same order as before; only the scratch arrays are reused (no garbage per tick).
export function think(g: number[], inp: number[], layers: number[], out: number[], bufs: number[][]): void {
  let cur = inp, n = inp.length, k = 0;
  for (let l = 0; l < layers.length; l++) {
    const nxt = bufs[l], m = layers[l];
    for (let j = 0; j < m; j++) { let s = 0; for (let i = 0; i < n; i++) s += cur[i] * g[k++]; nxt[j] = tanh(s + g[k++]); }
    cur = nxt; n = m;
  }
  for (let j = 0; j < out.length; j++) { let s = 0; for (let i = 0; i < n; i++) s += cur[i] * g[k++]; out[j] = tanh(s + g[k++]); }
}
// Gap across the wrapped map, in -200..200. Was ((d + 600) % 400) - 200; for |d| < 400 the % only ever
// subtracts 0, 400 or 800, and those subtractions are exact in floating point, so this is bit-identical.
function wrap(d: number): number {
  let x = d + 1.5 * SIZE;
  if (x >= 2 * SIZE) x -= 2 * SIZE;
  else if (x >= SIZE) x -= SIZE;
  return x - SIZE / 2;
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
  private readonly out = [0, 0, 0, 0];

  readonly lv: Level; readonly rule: boolean; readonly layers: number[]; readonly genomes: number[][];

  readonly sp: Species;
  readonly body: Body;
  private readonly see: number;
  private readonly wk: number[][] | null = null; // working brains (learning in life)
  private readonly tr: number[][] | null = null;

  constructor(lv: Level, rule: boolean, build: Sense[], layers: number[], genomes: number[][], mapSeed: number, sp: Species = SPECIES[0], body?: Body) {
    this.sp = sp;
    this.body = body ?? makeBody(sp);
    this.see = SEE * this.body.seeMul * (lv.sight ?? 1);
    if (!rule && this.body.learn > 0) { this.wk = genomes.map((g) => g.slice()); this.tr = genomes.map((g) => new Array<number>(g.length).fill(0)); }
    this.lv = lv; this.rule = rule; this.layers = layers; this.genomes = genomes;
    const r = (this.r = createRng(mapSeed));
    for (let i = 0; i < lv.good + lv.bad; i++) { this.fx.push(r.next() * SIZE); this.fy.push(r.next() * SIZE); this.bad.push(i >= lv.good); }
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
  }

  get done(): boolean { return this.t >= T; }

  step(): void {
    const { lv, r, fx, fy, bad, px, py, hx, hy, en, taste, alive, st, kx, ky, kdx, kdy, rest, inp, out } = this;
    const nf = fx.length, n = px.length;
    const hasP = this.b.includes("poison"), hasT = this.b.includes("taste"), hasH = this.b.includes("hunter"), hasE = this.b.includes("energy"), hasN = this.b.includes("neighbour");
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      st[i].life++;
      const see = this.see;
      let fi = -1, fd = see * see, pi = -1, pd = see * see, hi = -1, hd = see * see;
      for (let f = 0; f < nf; f++) {
        const dx = wrap(fx[f] - px[i]), dx2 = dx * dx;
        if (dx2 >= fd && (!bad[f] || dx2 >= pd)) continue; // too far sideways to beat either record
        const dy = wrap(fy[f] - py[i]), d = dx2 + dy * dy;
        if (d < fd) { fd = d; fi = f; }
        if (bad[f] && d < pd) { pd = d; pi = f; }
      }
      for (let h = 0; h < lv.hunters; h++) {
        const dx = wrap(kx[h] - px[i]), dx2 = dx * dx;
        if (dx2 >= hd) continue;
        const dy = wrap(ky[h] - py[i]), d = dx2 + dy * dy;
        if (d < hd) { hd = d; hi = h; }
      }
      const toward = (tx: number, ty: number, k: number, found: boolean) => {
        if (!found) { inp[k] = 0; inp[k + 1] = 0; inp[k + 2] = 0; return k + 3; }
        const dx = wrap(tx - px[i]), dy = wrap(ty - py[i]), d = Math.sqrt(dx * dx + dy * dy) || 1;
        inp[k] = (dx * hx[i] + dy * hy[i]) / d; inp[k + 1] = (-dx * hy[i] + dy * hx[i]) / d; inp[k + 2] = 1 - d / see;
        return k + 3;
      };
      let k = toward(fi >= 0 ? fx[fi] : 0, fi >= 0 ? fy[fi] : 0, 0, fi >= 0);
      if (hasP) k = toward(pi >= 0 ? fx[pi] : 0, pi >= 0 ? fy[pi] : 0, k, pi >= 0);
      if (hasT) inp[k++] = taste[i];
      if (hasH) k = toward(hi >= 0 ? kx[hi] : 0, hi >= 0 ? ky[hi] : 0, k, hi >= 0);
      if (hasE) inp[k++] = en[i] - 1;
      if (hasN) { // nearest other living creature (crowding: the lab measured +6.8 food from this sense)
        let ni = -1, nd = see * see;
        for (let j = 0; j < n; j++) {
          if (j === i || !alive[j]) continue;
          const dx = wrap(px[j] - px[i]), dx2 = dx * dx;
          if (dx2 >= nd) continue;
          const dy = wrap(py[j] - py[i]), d = dx2 + dy * dy;
          if (d < nd) { nd = d; ni = j; }
        }
        k = toward(ni >= 0 ? px[ni] : 0, ni >= 0 ? py[ni] : 0, k, ni >= 0);
      }
      inp.length = k;
      let act = 3;
      if (this.rule) {
        if (hi >= 0 && hd < FLEE_AT * FLEE_AT) act = 2;
        else if (fi >= 0 && fi === pi && this.sp.goal !== "eaten") act = 1; // a scavenger's bot swallows poison too
        else act = 0;
      } else {
        think(this.wk ? this.wk[i] : this.genomes[i], inp, this.layers, out, this.bufs);
        if (this.tr) traceStep(this.tr[i], inp, this.layers, this.bufs, out);
        let best = -2;
        for (let a = 0; a < 4; a++) {
          if ((a === 1 && !hasP) || (a === 2 && !hasH)) continue; // an action needs its sense
          if (out[a] > best) { best = out[a]; act = a; }
        }
      }
      this.act[i] = act;
      const face = (dx: number, dy: number) => { const d = Math.sqrt(dx * dx + dy * dy) || 1; hx[i] = dx / d; hy[i] = dy / d; };
      const turn = (a: number) => { const c = cos(a), s = sin(a), x = hx[i]; hx[i] = x * c - hy[i] * s; hy[i] = x * s + hy[i] * c; };
      if (act === 0 && fi >= 0) face(wrap(fx[fi] - px[i]), wrap(fy[fi] - py[i]));
      else if (act === 1 && pi >= 0) face(-wrap(fx[pi] - px[i]), -wrap(fy[pi] - py[i]));
      else if (act === 2 && hi >= 0) face(-wrap(kx[hi] - px[i]), -wrap(ky[hi] - py[i]));
      else turn(r.gauss() * 0.2);
      const spd = this.body.speed;
      px[i] = (px[i] + hx[i] * spd + SIZE) % SIZE; py[i] = (py[i] + hy[i] * spd + SIZE) % SIZE;
      if (fi >= 0) {
        const dx = wrap(fx[fi] - px[i]), dy = wrap(fy[fi] - py[i]);
        if (dx * dx + dy * dy < BITE * BITE) {
          if (bad[fi]) { en[i] -= POISON * this.body.poisonHurt; st[i].bad++; st[i].score--; taste[i] = 1; }
          else { en[i] = Math.min(this.body.emax, en[i] + this.body.meal); st[i].good++; st[i].score++; taste[i] = -1; }
          if (this.wk && this.tr) en[i] -= LEARN_COST * learnFrom(this.wk[i], this.tr[i], this.body.learn * (bad[fi] ? -1 : 1));
          fx[fi] = r.next() * SIZE; fy[fi] = r.next() * SIZE;
        }
      }
      en[i] -= HUNGER * this.body.hunger;
      if (en[i] <= 0) { alive[i] = false; st[i].starved = 1; }
    }
    for (let h = 0; h < lv.hunters; h++) {
      if (rest[h] > 0) { rest[h]--; continue; }
      let ti = -1, td = HUNT_SEE * HUNT_SEE;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const dx = wrap(px[i] - kx[h]), dx2 = dx * dx;
        if (dx2 >= td) continue;
        const dy = wrap(py[i] - ky[h]), d = dx2 + dy * dy;
        if (d < td) { td = d; ti = i; }
      }
      let sp = 1;
      if (ti >= 0) {
        const dx = wrap(px[ti] - kx[h]), dy = wrap(py[ti] - ky[h]), d = Math.sqrt(dx * dx + dy * dy) || 1;
        kdx[h] = dx / d; kdy[h] = dy / d; sp = HUNTER_SPEED;
        if (d < CATCH) { alive[ti] = false; st[ti].hunted = 1; rest[h] = REST; continue; }
      } else { const a = r.gauss() * 0.2, c = cos(a), s = sin(a), x = kdx[h]; kdx[h] = x * c - kdy[h] * s; kdy[h] = x * s + kdy[h] * c; }
      kx[h] = (kx[h] + kdx[h] * sp + SIZE) % SIZE; ky[h] = (ky[h] + kdy[h] * sp + SIZE) % SIZE;
    }
    this.t++;
  }
}

// Input order is fixed: food(3) poison(3) taste(1) hunter(3) energy(1), only the chosen senses present.
const INPUT_ORDER: [string, number][] = [["food", 3], ["poison", 3], ["taste", 1], ["hunter", 3], ["energy", 1], ["neighbour", 3]];
const inputKeys = (b: Sense[]) => INPUT_ORDER.flatMap(([s, n]) => (s === "food" || b.includes(s as Sense) ? Array.from({ length: n }, (_, i) => s + i) : []));
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
export function heldOut(lv: Level, rule: boolean, build: Sense[], layers: number[], g: number[], sp: Species = SPECIES[0], body?: Body): Stats {
  const all: Stats[] = [];
  for (const s of HELD) all.push(...episode(lv, rule, build, layers, Array.from({ length: POP }, () => g), s, sp, body));
  return mean(all);
}

// Evolution, one generation per call. Same rules as proto/tune.ts run().
export class Evolver {
  gen = 0;
  readonly hist: number[] = []; // progress every EVERY generations
  pop: number[][];
  champ: number[] | null = null;
  champStats: Stats | null = null;
  ruleStats: Stats;
  private readonly er: Rng;

  lv: Level; build: Sense[]; readonly layers: number[]; readonly seed: number;

  set: Settings; // the player may change the reward (and gain body cards) between stages
  readonly sp: Species;
  // Powers: change only the training world for a few generations; the test maps never change.
  private effects: { kind: Power; until: number }[] = [];
  // Tests only: skip checks before this generation (they never change evolution, only the progress shown).
  checkAfter = 0;
  usePower(kind: Power): void { this.effects.push({ kind, until: this.gen + POWERS[kind].gens }); }
  activePowers(gen = this.gen + 1): Power[] { return this.effects.filter((e) => gen <= e.until).map((e) => e.kind); }

  constructor(lv: Level, build: Sense[], layers: number[], seed: number, set: Settings = DEFAULT_SETTINGS, sp: Species = SPECIES[0]) {
    this.lv = lv; this.build = build; this.layers = layers; this.seed = seed; this.set = set; this.sp = sp;
    this.er = createRng(seed * 7919 + 13);
    this.ruleStats = heldOut(lv, true, build, layers, [], sp);
    const size = gSize(nIn(build), layers);
    this.pop = Array.from({ length: set.pop }, () => Array.from({ length: size }, () => this.er.gauss() * 0.5));
  }

  // Roguelite runs (Rey 2026-10-29): the same species moves on to the next stage. Its brains keep what
  // they learned; inputs for newly added senses start at weight 0 (the brain ignores them until evolution
  // finds a use). Changes no random numbers, so a run is still fully set by its seed and choices.
  nextStage(lv: Level, build: Sense[]): void {
    this.pop = this.pop.map((g) => expandGenome(g, this.build, build, this.layers));
    this.lv = lv; this.build = build;
    this.ruleStats = heldOut(lv, true, build, this.layers, [], this.sp);
    this.champ = null; this.champStats = null;
  }

  // One generation as small pieces: yields every SLICE ticks so a page can draw in between, and returns
  // the new progress when this generation was a check (else null). step() runs it straight through.
  *generation(): Generator<void, number | null> {
    const gen = this.gen + 1, er = this.er;
    const body = makeBody(this.sp, this.set.body ?? []);
    const on = this.activePowers(gen);
    let trainLv = this.lv;
    if (on.includes("food")) trainLv = { ...trainLv, good: Math.round(trainLv.good * 1.5) };
    if (on.includes("shelter")) trainLv = { ...trainLv, hunters: 0 };
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
    const parents = order.slice(0, np).map((i) => this.pop[i]);
    const next = parents.slice(0, ne).map((g) => g.slice());
    while (next.length < this.pop.length) next.push(parents[next.length % np].map((x) => (er.next() < 0.2 ? x + er.gauss() * mu : x)));
    this.pop = next;
    return p;
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

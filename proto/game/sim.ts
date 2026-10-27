// Learning-game world, one tick at a time (the page watches it; evolution runs it flat out).
// Same arithmetic and random-number order as proto/tune.ts, so the page reproduces the measured numbers.
import { sin, cos, tanh } from "../../src/engine/dmath.ts";
import { createRng, type Rng } from "../../src/engine/rng.ts";

export const SIZE = 400, T = 800, POP = 30, EVERY = 5, HELD = [101, 102], BAR = 0.8;
const SLICE = 40; // ticks between pauses when evolution shares the page with drawing
const SPEED = 2, SEE = 150, FLEE_AT = 60, BITE = 6, CATCH = 8, HUNTER_SPEED = 1.9, REST = 20, HUNT_SEE = 120;
const HUNGER = 0.0015, MEAL = 0.3, POISON = 0.35, EMAX = 1.5;

export type Sense = "poison" | "taste" | "hunter" | "energy";
export interface Level { id: string; name: string; good: number; bad: number; hunters: number; menu: Sense[]; blurb: string }
// Tuned in proto/tune.ts (5 seeds x 300 generations): the right pair learns 5/5, the trap pair 0/5.
export const LEVELS: Level[] = [
  { id: "L1", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"],
    blurb: "20 of the 50 beads here are poison. Eating poison costs energy and a point." },
  { id: "L2", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"],
    blurb: "Six hunters roam. A caught creature is out for the rest of the round." },
];
export const SENSE_INFO: Record<Sense, string> = {
  poison: "see poison: direction and distance of the nearest poison bead",
  taste: "taste: was my last bite poison?",
  hunter: "see hunter: direction and distance of the nearest hunter",
  energy: "feel energy: how full am I?",
};
export const ACTIONS = ["eat", "avoid", "flee", "wander"] as const;

export interface Stats { score: number; good: number; bad: number; hunted: number; starved: number }
const newStats = (): Stats => ({ score: 0, good: 0, bad: 0, hunted: 0, starved: 0 });

export const nIn = (b: Sense[]) => 3 + (b.includes("poison") ? 3 : 0) + (b.includes("taste") ? 1 : 0) + (b.includes("hunter") ? 3 : 0) + (b.includes("energy") ? 1 : 0);
export function gSize(nin: number, layers: number[], nout = 4): number {
  let s = 0, prev = nin;
  for (const h of [...layers, nout]) { s += prev * h + h; prev = h; }
  return s;
}
// Same arithmetic, same order as before; only the scratch arrays are reused (no garbage per tick).
function think(g: number[], inp: number[], layers: number[], out: number[], bufs: number[][]): void {
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

  constructor(lv: Level, rule: boolean, build: Sense[], layers: number[], genomes: number[][], mapSeed: number) {
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
    const hasP = this.b.includes("poison"), hasT = this.b.includes("taste"), hasH = this.b.includes("hunter"), hasE = this.b.includes("energy");
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let fi = -1, fd = SEE * SEE, pi = -1, pd = SEE * SEE, hi = -1, hd = SEE * SEE;
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
        inp[k] = (dx * hx[i] + dy * hy[i]) / d; inp[k + 1] = (-dx * hy[i] + dy * hx[i]) / d; inp[k + 2] = 1 - d / SEE;
        return k + 3;
      };
      let k = toward(fi >= 0 ? fx[fi] : 0, fi >= 0 ? fy[fi] : 0, 0, fi >= 0);
      if (hasP) k = toward(pi >= 0 ? fx[pi] : 0, pi >= 0 ? fy[pi] : 0, k, pi >= 0);
      if (hasT) inp[k++] = taste[i];
      if (hasH) k = toward(hi >= 0 ? kx[hi] : 0, hi >= 0 ? ky[hi] : 0, k, hi >= 0);
      if (hasE) inp[k++] = en[i] - 1;
      inp.length = k;
      let act = 3;
      if (this.rule) {
        if (hi >= 0 && hd < FLEE_AT * FLEE_AT) act = 2;
        else if (fi >= 0 && fi === pi) act = 1;
        else act = 0;
      } else {
        think(this.genomes[i], inp, this.layers, out, this.bufs);
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
      px[i] = (px[i] + hx[i] * SPEED + SIZE) % SIZE; py[i] = (py[i] + hy[i] * SPEED + SIZE) % SIZE;
      if (fi >= 0) {
        const dx = wrap(fx[fi] - px[i]), dy = wrap(fy[fi] - py[i]);
        if (dx * dx + dy * dy < BITE * BITE) {
          if (bad[fi]) { en[i] -= POISON; st[i].bad++; st[i].score--; taste[i] = 1; }
          else { en[i] = Math.min(EMAX, en[i] + MEAL); st[i].good++; st[i].score++; taste[i] = -1; }
          fx[fi] = r.next() * SIZE; fy[fi] = r.next() * SIZE;
        }
      }
      en[i] -= HUNGER;
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

export function episode(lv: Level, rule: boolean, build: Sense[], layers: number[], genomes: number[][], mapSeed: number): Stats[] {
  const w = new World(lv, rule, build, layers, genomes, mapSeed);
  while (!w.done) w.step();
  return w.st;
}

export function mean(st: Stats[]): Stats {
  const m = newStats();
  for (const s of st) { m.score += s.score; m.good += s.good; m.bad += s.bad; m.hunted += s.hunted; m.starved += s.starved; }
  for (const key of Object.keys(m) as (keyof Stats)[]) m[key] /= st.length;
  return m;
}

// One brain (cloned for the whole population) on the 2 maps evolution never trains on.
export function heldOut(lv: Level, rule: boolean, build: Sense[], layers: number[], g: number[]): Stats {
  const all: Stats[] = [];
  for (const s of HELD) all.push(...episode(lv, rule, build, layers, Array.from({ length: POP }, () => g), s));
  return mean(all);
}

// Evolution, one generation per call. Same rules as proto/tune.ts run().
export class Evolver {
  gen = 0;
  readonly hist: number[] = []; // progress every EVERY generations
  pop: number[][];
  champ: number[] | null = null;
  champStats: Stats | null = null;
  readonly ruleStats: Stats;
  private readonly er: Rng;

  readonly lv: Level; readonly build: Sense[]; readonly layers: number[]; readonly seed: number;

  constructor(lv: Level, build: Sense[], layers: number[], seed: number) {
    this.lv = lv; this.build = build; this.layers = layers; this.seed = seed;
    this.er = createRng(seed * 7919 + 13);
    this.ruleStats = heldOut(lv, true, build, layers, []);
    const size = gSize(nIn(build), layers);
    this.pop = Array.from({ length: POP }, () => Array.from({ length: size }, () => this.er.gauss() * 0.5));
  }

  // One generation as small pieces: yields every SLICE ticks so a page can draw in between, and returns
  // the new progress when this generation was a check (else null). step() runs it straight through.
  *generation(): Generator<void, number | null> {
    const gen = this.gen + 1, er = this.er;
    const w = new World(this.lv, false, this.build, this.layers, this.pop, this.seed * 1000 + gen);
    while (!w.done) { w.step(); if (w.t % SLICE === 0) yield; }
    this.gen = gen;
    const st = w.st;
    const order = this.pop.map((_, i) => i).sort((a, b) => st[b].score - st[a].score || a - b);
    let p: number | null = null;
    if (gen % EVERY === 0) {
      const champ = this.pop[order[0]].slice();
      const all: Stats[] = [];
      for (const s of HELD) {
        const hw = new World(this.lv, false, this.build, this.layers, Array.from({ length: POP }, () => champ), s);
        while (!hw.done) { hw.step(); if (hw.t % SLICE === 0) yield; }
        all.push(...hw.st);
      }
      this.champ = champ;
      this.champStats = mean(all);
      p = this.champStats.score / this.ruleStats.score;
      this.hist.push(p);
    }
    const parents = order.slice(0, 6).map((i) => this.pop[i]);
    const next = parents.slice(0, 3).map((g) => g.slice());
    while (next.length < POP) next.push(parents[next.length % 6].map((x) => (er.next() < 0.2 ? x + er.gauss() * 0.3 : x)));
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
export function why(lv: Level, build: Sense[], c: Stats, b: Stats, progress: number): string {
  if (progress >= BAR) return progress >= 1 ? "Beats the hand-written bot." : "Close to the hand-written bot: level passed.";
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

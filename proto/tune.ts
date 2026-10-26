// THROWAWAY: the brief's cheapest test (learning game, 2026-10-26). Named actions + 2 slots of 3 senses.
//   1. level tuning: does each level make the pick matter, and does the right pair learn on >= 4 of 5 seeds?
//   2. creds: progress every 5 generations for 300 generations; creds = new highs only vs "every rise" (farming risk)
//   3. brain size: hidden [6] vs [12] vs [6, 6], paired by seed
//   node proto/tune.ts [--seeds=5] [--gens=300]
import { sin, cos, tanh } from "../src/engine/dmath.ts";
import { createRng } from "../src/engine/rng.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";

const opt = (k: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const SIZE = 400, T = 800, POP = 30, EVERY = 5, HELD = [101, 102], BAR = 0.8, GENS = opt("gens", 300);
const SPEED = 2, SEE = 150, FLEE_AT = 60, BITE = 6, CATCH = 8, HUNTER_SPEED = 1.9, REST = 20, HUNT_SEE = 120;
const HUNGER = 0.0015, MEAL = 0.3, POISON = 0.35, EMAX = 1.5;

type Extra = "poison" | "taste" | "hunter" | "energy";
interface Level { name: string; good: number; bad: number; hunters: number; menu: Extra[] }
const HUNT_ONLY = opt("hunt", 0) === 1;
const LEVELS: Level[] = HUNT_ONLY ? [
  { name: "hunted 4h/15p", good: 40, bad: 15, hunters: 4, menu: ["poison", "hunter", "energy"] },
  { name: "hunted 6h/8p", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"] },
  { name: "hunted 4h/8p", good: 40, bad: 8, hunters: 4, menu: ["poison", "hunter", "energy"] },
] : [
  { name: "poison patch 10", good: 30, bad: 10, hunters: 0, menu: ["poison", "taste", "energy"] },
  { name: "poison patch 20", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"] },
  { name: "hunted 15", good: 40, bad: 15, hunters: 6, menu: ["poison", "hunter", "energy"] },
];
const BRAINS: number[][] = HUNT_ONLY ? [[6]] : [[6], [12], [6, 6]];
interface Job { level: number; brain: number; build: Extra[]; seed: number }
interface Stats { score: number; good: number; bad: number; hunted: number; starved: number }
interface Result extends Job { hist: number[]; rule: number; champ: Stats; ruleStats: Stats; sec: number }

const nIn = (b: Extra[]) => 3 + (b.includes("poison") ? 3 : 0) + (b.includes("taste") ? 1 : 0) + (b.includes("hunter") ? 3 : 0) + (b.includes("energy") ? 1 : 0);
function gSize(nin: number, layers: number[], nout: number): number {
  let s = 0, prev = nin;
  for (const h of [...layers, nout]) { s += prev * h + h; prev = h; }
  return s;
}
function think(g: number[], inp: number[], layers: number[], out: number[]): void {
  let cur = inp, k = 0;
  const sizes = [...layers, out.length];
  for (let l = 0; l < sizes.length; l++) {
    const nxt: number[] = [];
    for (let j = 0; j < sizes[l]; j++) { let s = 0; for (let i = 0; i < cur.length; i++) s += cur[i] * g[k++]; nxt[j] = tanh(s + g[k++]); }
    cur = nxt;
  }
  for (let j = 0; j < out.length; j++) out[j] = cur[j];
}
const wrap = (d: number) => ((d + 1.5 * SIZE) % SIZE) - SIZE / 2;

function episode(lv: Level, rule: boolean, build: Extra[], layers: number[], genomes: number[][], mapSeed: number): Stats[] {
  const r = createRng(mapSeed);
  const nf = lv.good + lv.bad;
  const fx: number[] = [], fy: number[] = [], bad: boolean[] = [];
  for (let i = 0; i < nf; i++) { fx.push(r.next() * SIZE); fy.push(r.next() * SIZE); bad.push(i >= lv.good); }
  const n = genomes.length;
  const px: number[] = [], py: number[] = [], hx: number[] = [], hy: number[] = [], en: number[] = [], taste: number[] = [], alive: boolean[] = [];
  const st: Stats[] = [];
  for (let i = 0; i < n; i++) {
    px.push(r.next() * SIZE); py.push(r.next() * SIZE);
    const a = r.next() * 2 * Math.PI; hx.push(cos(a)); hy.push(sin(a));
    en.push(1); taste.push(0); alive.push(true); st.push({ score: 0, good: 0, bad: 0, hunted: 0, starved: 0 });
  }
  const kx: number[] = [], ky: number[] = [], kdx: number[] = [], kdy: number[] = [], rest: number[] = [];
  for (let i = 0; i < lv.hunters; i++) { kx.push(r.next() * SIZE); ky.push(r.next() * SIZE); const a = r.next() * 2 * Math.PI; kdx.push(cos(a)); kdy.push(sin(a)); rest.push(0); }
  const b = rule ? lv.menu.filter((e) => e === "poison" || e === "hunter") : build;
  const inp: number[] = [], out: number[] = [0, 0, 0, 0];
  const hasP = b.includes("poison"), hasT = b.includes("taste"), hasH = b.includes("hunter"), hasE = b.includes("energy");
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let fi = -1, fd = SEE * SEE, pi = -1, pd = SEE * SEE, hi = -1, hd = SEE * SEE;
      for (let f = 0; f < nf; f++) {
        const dx = wrap(fx[f] - px[i]), dy = wrap(fy[f] - py[i]), d = dx * dx + dy * dy;
        if (d < fd) { fd = d; fi = f; }
        if (bad[f] && d < pd) { pd = d; pi = f; }
      }
      for (let h = 0; h < lv.hunters; h++) {
        const dx = wrap(kx[h] - px[i]), dy = wrap(ky[h] - py[i]), d = dx * dx + dy * dy;
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
      if (rule) {
        if (hi >= 0 && hd < FLEE_AT * FLEE_AT) act = 2;
        else if (fi >= 0 && fi === pi) act = 1;
        else act = 0;
      } else {
        think(genomes[i], inp, layers, out);
        let best = -2;
        for (let a = 0; a < 4; a++) {
          if ((a === 1 && !hasP) || (a === 2 && !hasH)) continue;
          if (out[a] > best) { best = out[a]; act = a; }
        }
      }
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
        const dx = wrap(px[i] - kx[h]), dy = wrap(py[i] - ky[h]), d = dx * dx + dy * dy;
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
  }
  return st;
}

function mean(st: Stats[]): Stats {
  const m = { score: 0, good: 0, bad: 0, hunted: 0, starved: 0 };
  for (const s of st) { m.score += s.score; m.good += s.good; m.bad += s.bad; m.hunted += s.hunted; m.starved += s.starved; }
  for (const key of Object.keys(m) as (keyof Stats)[]) m[key] /= st.length;
  return m;
}

function run(j: Job): Result {
  const t0 = performance.now();
  const lv = LEVELS[j.level], layers = BRAINS[j.brain];
  const er = createRng(j.seed * 7919 + 13);
  const size = gSize(nIn(j.build), layers, 4);
  const held = (rule: boolean, g: number[]) => { const all: Stats[] = []; for (const s of HELD) all.push(...episode(lv, rule, j.build, layers, Array.from({ length: POP }, () => g), s)); return mean(all); };
  const ruleStats = held(true, []);
  let pop = Array.from({ length: POP }, () => Array.from({ length: size }, () => er.gauss() * 0.5));
  const hist: number[] = [];
  let champ = ruleStats;
  for (let gen = 1; gen <= GENS; gen++) {
    const st = episode(lv, false, j.build, layers, pop, j.seed * 1000 + gen);
    const order = pop.map((_, i) => i).sort((a, b) => st[b].score - st[a].score || a - b);
    if (gen % EVERY === 0) { champ = held(false, pop[order[0]]); hist.push(champ.score / ruleStats.score); }
    const parents = order.slice(0, 6).map((i) => pop[i]);
    const next = parents.slice(0, 3).map((g) => g.slice());
    while (next.length < POP) next.push(parents[next.length % 6].map((x) => (er.next() < 0.2 ? x + er.gauss() * 0.3 : x)));
    pop = next;
  }
  return { ...j, hist, rule: ruleStats.score, champ, ruleStats, sec: (performance.now() - t0) / 1000 };
}

// creds: new highs only (from 0) vs paying every rise between two checks
const highs = (h: number[], upto = h.length) => { let best = 0; for (let i = 0; i < upto; i++) best = Math.max(best, h[i]); return best; };
const rises = (h: number[]) => { let s = Math.max(0, h[0] ?? 0); for (let i = 1; i < h.length; i++) s += Math.max(0, h[i] - h[i - 1]); return s; };

const pairs = (m: Extra[]) => [[m[0], m[1]], [m[0], m[2]], [m[1], m[2]]];
const name = (b: Extra[]) => "food+" + b.join("+");
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pm = (xs: number[]) => `${f(avg(xs))} ±${f(margin(xs, 0.05))}`;

function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs, ${GENS} generations each, in ${f(wall, 0)} s. progress = best brain / rule bot on 2 unseen maps, every ${EVERY} gens; learned = progress >= ${BAR}.`);
  const at = (g: number) => g / EVERY;
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const L = rs.filter((r) => r.level === lv);
    console.log(`\n== ${LEVELS[lv].name} (menu ${LEVELS[lv].menu.join(", ")}; rule bot ${f(L[0].rule)} per prey)`);
    for (let b = 0; b < BRAINS.length; b++) {
      console.log(`  brain [${BRAINS[b].join(",")}]`);
      for (const p of pairs(LEVELS[lv].menu)) {
        const V = L.filter((r) => r.brain === b && name(r.build) === name(p)).sort((x, y) => x.seed - y.seed);
        const learnGen = V.map((r) => { const i = r.hist.findIndex((x) => x >= BAR); return i < 0 ? -1 : (i + 1) * EVERY; });
        const ok = learnGen.filter((g) => g > 0).sort((x, y) => x - y);
        const sec = V.map((r) => r.sec / GENS);
        console.log(`    ${name(p).padEnd(22)} learned ${ok.length}/${V.length} (gens ${ok.join(",") || "-"}) | best ${pm(V.map((r) => highs(r.hist)))} | at gen 50 ${f(avg(V.map((r) => highs(r.hist, at(50)))))} 100 ${f(avg(V.map((r) => highs(r.hist, at(100)))))} | creds new-highs ${f(avg(V.map((r) => highs(r.hist))))} vs every-rise ${f(avg(V.map((r) => rises(r.hist))))} | ${f(avg(sec) * 1000, 0)} ms/gen`);
      }
    }
    // pick matters? best pair minus each other pair, paired by seed, brain [6]
    const base = L.filter((r) => r.brain === 0);
    const best = pairs(LEVELS[lv].menu).map((p) => ({ p, m: avg(base.filter((r) => name(r.build) === name(p)).map((r) => highs(r.hist))) })).sort((a, b) => b.m - a.m);
    const by = (p: Extra[]) => base.filter((r) => name(r.build) === name(p)).sort((x, y) => x.seed - y.seed).map((r) => highs(r.hist));
    const top = by(best[0].p);
    console.log(`  pick matters (brain [6], best = ${name(best[0].p)}): ` + best.slice(1).map((o) => { const d = top.map((x, i) => x - by(o.p)[i]); return `minus ${name(o.p)} ${pm(d)}`; }).join(" | "));
    // brain size, paired by seed and build, vs [6]
    for (let b = 1; b < BRAINS.length; b++) {
      const d: number[] = [];
      for (const r of L.filter((r) => r.brain === b)) { const o = L.find((x) => x.brain === 0 && x.seed === r.seed && name(x.build) === name(r.build))!; d.push(highs(r.hist) - highs(o.hist)); }
      const dl: number[] = [];
      for (const r of L.filter((r) => r.brain === b)) { const o = L.find((x) => x.brain === 0 && x.seed === r.seed && name(x.build) === name(r.build))!; dl.push(highs(r.hist, at(100)) - highs(o.hist, at(100))); }
      console.log(`  brain [${BRAINS[b].join(",")}] minus [6], all builds paired: best ${pm(d)} | by gen 100 ${pm(dl)}`);
    }
  }
}

if (isMainThread) {
  const seeds = opt("seeds", 5);
  const js: Job[] = [];
  for (let level = 0; level < LEVELS.length; level++) for (let brain = 0; brain < BRAINS.length; brain++) for (const build of pairs(LEVELS[level].menu)) for (let seed = 1; seed <= seeds; seed++) js.push({ level, brain, build, seed });
  const t0 = performance.now(), threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  mkdirSync("proto/out", { recursive: true });
  writeFileSync(HUNT_ONLY ? "proto/out/tune-hunt.json" : "proto/out/tune.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

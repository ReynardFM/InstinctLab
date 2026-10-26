// THROWAWAY prototype for the learning-game idea (step 2a: numbers only, no page).
// Not part of the engine; nothing imports it. Questions it answers:
//   Q1 named actions vs steering, Q2 slots vs energy cost per sense,
//   and kill-if: does any variant learn a level in under ~30 s?
// "Learned" = the best brain scores >= 80% of a hand-written rule bot on 2 maps it never trained on.
//
//   node proto/learn-game.ts            all variants, 5 seeds, 2 threads
//   node proto/learn-game.ts --seeds=3  fewer seeds
import { sin, cos, tanh } from "../src/engine/dmath.ts";
import { createRng, type Rng } from "../src/engine/rng.ts";
import { margin } from "../src/cli/stats.ts";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const SIZE = 400, T = 800, POP = 30, EVERY = 5, HELD = [101, 102], BAR = 0.8;
const COS_TURN = cos(0.3);
const SPEED = 2, SEE = 150, FLEE_AT = 60, BITE = 6, CATCH = 8;
const opt = (k: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const GENS = opt("gens", 150), HUNTER_SPEED = opt("hspeed", 1.9), REST = opt("rest", 20), HUNT_SEE = opt("hsee", 120);
const HUNGER = 0.0015, MEAL = 0.3, POISON = 0.35, SENSE_COST = opt("cost", 0.0015), EMAX = 1.5, HID = 6;

type Extra = "poison" | "taste" | "hunter" | "energy";
const EXTRAS: Extra[] = ["poison", "taste", "hunter", "energy"];
type Style = "actions" | "steer";
type Budget = "slots" | "energy";
interface Level { name: string; good: number; bad: number; hunters: number }
const LEVELS: Level[] = [
  { name: "poison patch", good: 30, bad: 30, hunters: 0 },
  { name: "hunted", good: 40, bad: 5, hunters: opt("hunters", 6) },
];
// Unlocks: a level only offers senses for things that exist in it (Rey 2026-10-26).
const menu = (lv: Level): Extra[] => EXTRAS.filter((e) => (e === "poison" || e === "taste" ? lv.bad > 0 : e === "hunter" ? lv.hunters > 0 : true));
// Named actions: 0 eat (go to nearest food), 1 avoid poison, 2 flee hunter, 3 wander.
const ACTIONS = ["eat", "avoid", "flee", "wander"];

interface Job { level: number; style: Style; budget: Budget; build: Extra[]; seed: number }
interface Stats { score: number; good: number; bad: number; hunted: number; starved: number }
interface Result extends Job { learnedGen: number; learnedSec: number; final: number; rule: number; champ: Stats; ruleStats: Stats; sec: number }

const nIn = (b: Extra[]) => 3 + (b.includes("poison") ? 3 : 0) + (b.includes("taste") ? 1 : 0) + (b.includes("hunter") ? 3 : 0) + (b.includes("energy") ? 1 : 0);
const nOut = (s: Style) => (s === "actions" ? 4 : 2);
const gSize = (i: number, o: number) => i * HID + HID + HID * o + o;

function thinkN(g: number[], inp: number[], o: number, out: number[]): void {
  const n = inp.length, hid: number[] = [];
  let k = 0;
  for (let h = 0; h < HID; h++) { let s = 0; for (let i = 0; i < n; i++) s += inp[i] * g[k++]; hid[h] = tanh(s + g[k++]); }
  for (let j = 0; j < o; j++) { let s = 0; for (let h = 0; h < HID; h++) s += hid[h] * g[k++]; out[j] = tanh(s + g[k++]); }
}

const wrap = (d: number) => ((d + 1.5 * SIZE) % SIZE) - SIZE / 2;

// One map, one tick loop. kind "rule" ignores genomes and uses the hand-written bot.
function episode(lv: Level, style: Style, rule: boolean, build: Extra[], budget: Budget, genomes: number[][], mapSeed: number): Stats[] {
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
  const b = rule ? menu(lv).filter((e) => e === "poison" || e === "hunter") : build;
  const cost = budget === "energy" ? b.length * SENSE_COST : 0;
  const o = rule ? 4 : nOut(style), inp: number[] = [], out: number[] = [0, 0, 0, 0];
  const hasP = b.includes("poison"), hasT = b.includes("taste"), hasH = b.includes("hunter"), hasE = b.includes("energy");

  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      // senses: nearest food (any kind), nearest poison, nearest hunter
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

      let speed = SPEED;
      const face = (dx: number, dy: number) => { const d = Math.sqrt(dx * dx + dy * dy) || 1; hx[i] = dx / d; hy[i] = dy / d; };
      const turn = (a: number) => { const c = cos(a), s = sin(a), x = hx[i]; hx[i] = x * c - hy[i] * s; hy[i] = x * s + hy[i] * c; };
      let act = 3;
      if (rule) {
        if (hi >= 0 && hd < FLEE_AT * FLEE_AT) act = 2;
        else if (fi >= 0 && fi === pi) act = 1;
        else act = 0;
      } else if (style === "actions") {
        thinkN(genomes[i], inp, o, out);
        let best = -2;
        for (let a = 0; a < 4; a++) {
          if ((a === 1 && !hasP) || (a === 2 && !hasH)) continue; // an action needs its sense
          if (out[a] > best) { best = out[a]; act = a; }
        }
      }
      if (style === "steer" && !rule) {
        thinkN(genomes[i], inp, o, out);
        turn(out[0] * 0.3);
        speed = ((out[1] + 1) / 2) * SPEED;
      } else {
        let dx = 0, dy = 0, has = true;
        if (act === 0 && fi >= 0) { dx = wrap(fx[fi] - px[i]); dy = wrap(fy[fi] - py[i]); }
        else if (act === 1 && pi >= 0) { dx = -wrap(fx[pi] - px[i]); dy = -wrap(fy[pi] - py[i]); }
        else if (act === 2 && hi >= 0) { dx = -wrap(kx[hi] - px[i]); dy = -wrap(ky[hi] - py[i]); }
        else has = false;
        if (!has) turn(r.gauss() * 0.2);
        else if (style === "actions") face(dx, dy);
        else {
          // steering rule bot: same 0.3-per-tick turn limit as the steering brains
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if ((dx * hx[i] + dy * hy[i]) / d >= COS_TURN) face(dx, dy);
          else turn(hx[i] * dy - hy[i] * dx >= 0 ? 0.3 : -0.3);
        }
      }
      px[i] = (px[i] + hx[i] * speed + SIZE) % SIZE; py[i] = (py[i] + hy[i] * speed + SIZE) % SIZE;

      // eat on contact
      if (fi >= 0) {
        const dx = wrap(fx[fi] - px[i]), dy = wrap(fy[fi] - py[i]);
        if (dx * dx + dy * dy < BITE * BITE) {
          if (bad[fi]) { en[i] -= POISON; st[i].bad++; st[i].score--; taste[i] = 1; }
          else { en[i] = Math.min(EMAX, en[i] + MEAL); st[i].good++; st[i].score++; taste[i] = -1; }
          fx[fi] = r.next() * SIZE; fy[fi] = r.next() * SIZE;
        }
      }
      en[i] -= HUNGER + cost;
      if (en[i] <= 0) { alive[i] = false; st[i].starved = 1; }
    }
    // hunters chase the nearest live prey they can see
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
function heldOut(j: Job, rule: boolean, g: number[] | null): Stats {
  const all: Stats[] = [];
  for (const s of HELD) all.push(...episode(LEVELS[j.level], j.style, rule, j.build, j.budget, Array.from({ length: POP }, () => g ?? []), s));
  return mean(all);
}

function run(j: Job): Result {
  const t0 = performance.now();
  const er: Rng = createRng(j.seed * 7919 + 13);
  const size = gSize(nIn(j.build), nOut(j.style));
  let pop = Array.from({ length: POP }, () => Array.from({ length: size }, () => er.gauss() * 0.5));
  const ruleStats = heldOut(j, true, null);
  let learnedGen = -1, learnedSec = -1, champ: Stats = ruleStats, final = 0;
  for (let gen = 1; gen <= GENS; gen++) {
    const st = episode(LEVELS[j.level], j.style, false, j.build, j.budget, pop, j.seed * 1000 + gen);
    const order = pop.map((_, i) => i).sort((a, b) => st[b].score - st[a].score || a - b);
    if (gen % EVERY === 0) {
      champ = heldOut(j, false, pop[order[0]]);
      final = champ.score / ruleStats.score;
      if (learnedGen < 0 && final >= BAR) { learnedGen = gen; learnedSec = (performance.now() - t0) / 1000; }
    }
    const parents = order.slice(0, 6).map((i) => pop[i]);
    const next = parents.slice(0, 3).map((g) => g.slice());
    while (next.length < POP) next.push(parents[next.length % 6].map((x) => (er.next() < 0.2 ? x + er.gauss() * 0.3 : x)));
    pop = next;
  }
  return { ...j, learnedGen, learnedSec, final, rule: ruleStats.score, champ, ruleStats, sec: (performance.now() - t0) / 1000 };
}

// Why did a failed run fail? One sentence, from its build and how its prey died vs the rule bot's.
function why(r: Result): { text: string; explained: boolean } {
  const c = r.champ, b = r.ruleStats;
  if (LEVELS[r.level].hunters > 0 && c.hunted > b.hunted + 0.1) return r.build.includes("hunter") ? { text: "sees hunters, didn't learn to flee", explained: false } : { text: "can't see hunters", explained: true };
  if (c.bad > b.bad + 0.5) {
    if (r.build.includes("poison")) return { text: "sees poison, didn't learn to avoid it", explained: false };
    if (r.build.includes("taste")) return { text: "taste only tells after the bite (needs learning in life)", explained: true };
    return { text: "can't tell poison from food", explained: true };
  }
  if (c.starved > b.starved + 0.1) return r.budget === "energy" && r.build.length >= 2 ? { text: "senses cost too much energy", explained: true } : { text: "starves, didn't learn to find food", explained: false };
  return { text: "eats too slowly", explained: false };
}

function subsets(): Extra[][] { const out: Extra[][] = []; for (let m = 0; m < 16; m++) out.push(EXTRAS.filter((_, i) => m & (1 << i))); return out; }
function jobs(seeds: number): Job[] {
  const js: Job[] = [];
  const only = opt("level", -1);
  for (let level = 0; level < LEVELS.length; level++) if (only < 0 || only === level)
    for (const style of ["actions", "steer"] as Style[])
      for (const budget of ["slots", "energy"] as Budget[])
        for (const build of subsets().filter((s) => s.every((e) => menu(LEVELS[level]).includes(e)) && (budget === "slots" ? s.length <= 2 : true)))
          for (let seed = 1; seed <= seeds; seed++) js.push({ level, style, budget, build, seed });
  return js;
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const name = (b: Extra[]) => "food" + b.map((e) => "+" + e).join("");

function report(rs: Result[], wall: number): void {
  console.log(`${rs.length} runs in ${fmt(wall, 0)} s (2 threads). learned = >= ${BAR * 100}% of the rule bot on 2 unseen maps.`);
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const L = rs.filter((r) => r.level === lv);
    if (!L.length) continue;
    console.log(`\n== ${LEVELS[lv].name} (menu: food + ${menu(LEVELS[lv]).join(", ")}; energy cost ${SENSE_COST} per sense per tick, hunger ${HUNGER})`);
    for (const style of ["actions", "steer"] as Style[])
      for (const budget of ["slots", "energy"] as Budget[]) {
        const V = L.filter((r) => r.style === style && r.budget === budget);
        const learned = V.filter((r) => r.learnedGen > 0);
        const secs = learned.map((r) => r.learnedSec).sort((a, b) => a - b);
        const builds = [...new Set(V.map((r) => name(r.build)))].map((nm) => {
          const xs = V.filter((r) => name(r.build) === nm).map((r) => r.final);
          return { nm, m: xs.reduce((s, x) => s + x, 0) / xs.length, e: margin(xs, 0.05), k: V.filter((r) => name(r.build) === nm && r.learnedGen > 0).length, n: xs.length };
        }).sort((a, b) => b.m - a.m);
        const best = builds[0];
        const near = builds.filter((x) => x.m + x.e >= best.m - best.e).length;
        const fails = V.filter((r) => r.learnedGen < 0).map(why);
        const expl = fails.filter((f) => f.explained).length;
        console.log(`  ${style}/${budget} (rule bot ${fmt(V[0].rule)}): learned ${learned.length}/${V.length} runs | time to learn median ${fmt(secs[Math.floor(secs.length / 2)], 1)} s, slowest ${fmt(secs[secs.length - 1], 1)} s | run ${fmt(V.reduce((s, r) => s + r.sec, 0) / V.length, 1)} s`);
        console.log(`     best ${best.nm} ${fmt(best.m)} ±${fmt(best.e)} of rule (${best.k}/${best.n} learned) | builds tied with best: ${near}/${builds.length}`);
        console.log(`     top: ${builds.slice(0, 4).map((x) => `${x.nm} ${fmt(x.m)}`).join(", ")} | bottom: ${builds.slice(-2).map((x) => `${x.nm} ${fmt(x.m)}`).join(", ")}`);
        const counts = new Map<string, number>();
        for (const f of fails) counts.set(f.text + (f.explained ? "" : " (?)"), (counts.get(f.text + (f.explained ? "" : " (?)")) ?? 0) + 1);
        console.log(`     failures ${fails.length}, explained by build ${expl}: ${[...counts].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join("; ")}`);
      }
  }
}

if (isMainThread) {
  const arg = process.argv.find((a) => a.startsWith("--seeds="));
  const js = jobs(arg ? Number(arg.slice(8)) : 5);
  const t0 = performance.now();
  const threads = 2;
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise<Result[]>((ok, bad) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: js.filter((_, i) => i % threads === w), argv: process.argv.slice(2) });
    wk.on("message", ok); wk.on("error", bad);
  })));
  const all = parts.flat();
  const fs = await import("node:fs");
  fs.mkdirSync("proto/out", { recursive: true });
  fs.writeFileSync("proto/out/learn-game.json", JSON.stringify(all));
  report(all, (performance.now() - t0) / 1000);
} else {
  parentPort!.postMessage((workerData as Job[]).map(run));
}

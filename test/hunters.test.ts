// Hunters with brains (P2): deterministic, borrowed brains really come from extinct families, arrival
// at rules.hunterFrom, and turning brains on doesn't touch the prey's random numbers before then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, runGenerations, DEFAULT_RULES, type World } from "../src/engine/world.ts";
import { firstHunterBrains, hunterEyeInto } from "../src/engine/hunters.ts";
import { genomeSize } from "../src/engine/brain.ts";
import { inputCount, hunterInputCount } from "../src/engine/senses.ts";
import { LayoutPool, runGenerationsSplit } from "../src/cli/split.ts";

const SMALL = { ...DEFAULT_RULES, pop: 20, genTicks: 300, hunters: 4, hunterBrains: 1 };
const snapshot = (w: World) =>
  JSON.stringify([w.avgHist, w.caughtHist, w.hunterHist, w.hunterBrains.map((b) => [b.g, b.origin, b.from]), w.creatures.map((c) => c.g)]);

test("hunters with brains: same seed, same run", () => {
  const rules = { ...SMALL, hunterFrom: 3 };
  const a = createWorld(4, rules);
  const b = createWorld(4, rules);
  runGenerations(a, 8);
  runGenerations(b, 8);
  assert.equal(snapshot(a), snapshot(b));
  assert.equal(a.hunterHist.length, 6, "one entry per generation with hunters (generations 3 to 8)");
  assert.ok(a.caughtHist.some((x) => x > 0), "they catch something");
});

test("hunters arrive at rules.hunterFrom; before that the run is the same with or without brains", () => {
  const chasers = createWorld(9, { ...SMALL, hunterBrains: 0, hunterFrom: 5 });
  const brains = createWorld(9, { ...SMALL, hunterFrom: 5 });
  runGenerations(chasers, 4); // generations 1-4 finished, generation 5 starting
  runGenerations(brains, 4);
  assert.deepEqual(chasers.avgHist, brains.avgHist);
  assert.deepEqual(chasers.creatures.map((c) => c.g), brains.creatures.map((c) => c.g));
  assert.equal(chasers.caughtHist.length, 0, "no hunters before generation 5");
  assert.equal(brains.hunters.length, 4, "generation 5's first map has its hunters");
  assert.equal(brains.hunterBrains.length, 12, "the gene pool (rules.hunterPool)");
});

test("the first brain hunters: borrowed from the newest extinct families, alternating with random", () => {
  const w = createWorld(2, { ...SMALL, hunters: 5, hunterPool: 5, hunterFrom: 1000 });
  runGenerations(w, 6);
  assert.ok(w.legacy.length >= 3, `enough extinct families for the test (${w.legacy.length})`);
  const len = genomeSize(inputCount(w.rules), w.rules.hidden);
  const first = firstHunterBrains(w);
  assert.deepEqual(first.map((b) => b.origin), ["borrowed", "random", "borrowed", "random", "borrowed"]);
  const newest = [...w.legacy].reverse();
  first.filter((b) => b.origin === "borrowed").forEach((b, i) => {
    assert.equal(b.from, newest[i].id);
    assert.deepEqual(b.g, newest[i].ref.slice(0, len));
  });
  for (const b of first) assert.equal(b.g.length, len);
});

test("with no extinct family yet, every first hunter is random (and tagged so)", () => {
  const w = createWorld(2, { ...SMALL, hunterFrom: 1 });
  assert.equal(w.legacy.length, 0);
  assert.equal(w.hunterBrains.length, 12);
  assert.ok(w.hunterBrains.every((b) => b.origin === "random"));
});

test("breeding keeps the best hunter unchanged and the pool the same size", () => {
  const w = createWorld(3, { ...SMALL, hunterFrom: 1 });
  runGenerations(w, 1);
  const before = w.hunterBrains.map((b) => b.g);
  runGenerations(w, 1);
  const stats = w.hunterHist.at(-1)!;
  assert.equal(w.hunterBrains.length, 12);
  assert.ok(before.some((g) => JSON.stringify(g) === JSON.stringify(w.hunterBrains[0].g)), "the best brain was copied as it is");
  assert.ok(stats.best >= stats.avg);
});

test("splitting a run's maps across threads refuses hunters with brains (they would be lost)", async () => {
  const pool = new LayoutPool(1);
  try {
    await assert.rejects(runGenerationsSplit(createWorld(1, { ...SMALL, hunterFrom: 1 }), 1, pool), /hunters with brains/);
  } finally {
    await pool.close();
  }
});

// How many maps each brain of the pool played in the generation now running, after `gens` generations.
function mapsPlayed(rules: typeof SMALL, gens: number): number[][] {
  const w = createWorld(5, { ...rules, hunterFrom: 1 });
  const out: number[][] = [];
  for (let g = 0; g < gens; g++) {
    const brains = w.hunterBrains;
    runGenerations(w, 1);
    out.push(brains.map((b) => b.maps));
  }
  return out;
}

test("gene pool: 12 brains, 4 hunters, 3 maps: every brain plays exactly one map per generation", () => {
  for (const maps of mapsPlayed({ ...SMALL, hunterPool: 12 }, 3)) assert.deepEqual(maps, new Array(12).fill(1));
});

test("gene pool no bigger than the hunters: every brain plays every map (as before the pool existed)", () => {
  for (const maps of mapsPlayed({ ...SMALL, hunterPool: 4 }, 3)) assert.deepEqual(maps, [3, 3, 3, 3]);
  for (const maps of mapsPlayed({ ...SMALL, hunterPool: 1 }, 2)) assert.deepEqual(maps, [3, 3, 3, 3], "pool below the hunters = the hunters");
});

test("gene pool: when the maps don't reach every brain, turns carry over to the next generation", () => {
  const rules = { ...SMALL, hunterPool: 10, layouts: 1 }; // 4 seats a generation for 10 brains
  const total = new Array(10).fill(0);
  for (const maps of mapsPlayed(rules, 5)) maps.forEach((m, i) => (total[i] += m)); // 20 seats
  assert.deepEqual(total, new Array(10).fill(2), "each brain got 2 turns in 5 generations");
});

// ---------- ecosystem hunters (Rey's brief 2026-10-23) ----------
import { BEST_KEEP, HUNTER_CAP, liveEcoHunters, remember, thinHunters, type BestBrain } from "../src/engine/hunters.ts";
import { runTicks } from "../src/engine/world.ts";
import { inEcosystem } from "../src/engine/mode.ts";

const ECO = { ...DEFAULT_RULES, mode: 1, regrow: 100, pop: 20, genTicks: 300, ecoWarmup: 2, hunters: 4 };
const toEco = (seed: number, extra = {}) => {
  const w = createWorld(seed, { ...ECO, ...extra });
  while (!inEcosystem(w)) runTicks(w, 1);
  return w;
};

test("remember keeps the best 8, highest first; a tie doesn't push out an earlier brain", () => {
  const list: BestBrain[] = [];
  const b = (score: number, tag: number) => ({ g: [tag], score, origin: "random" as const, from: null });
  [5, 9, 1, 7, 7, 3, 8, 2, 6, 4, 9].forEach((s, i) => remember(list, b(s, i)));
  assert.equal(list.length, BEST_KEEP);
  assert.deepEqual(list.map((x) => x.score), [9, 9, 8, 7, 7, 6, 5, 4]);
  assert.deepEqual(list.slice(0, 2).map((x) => x.g[0]), [1, 10], "the earlier 9 stays ahead");
});

test("ecosystem hunters: none in the warm-up, rules.hunters come in on the first ecosystem tick", () => {
  const w = createWorld(3, ECO);
  runTicks(w, 10);
  assert.equal(w.hunters.length, 0, "warm-up generation: no hunters");
  while (!inEcosystem(w)) runTicks(w, 1);
  runTicks(w, 1);
  assert.ok(w.eco.huntersStarted);
  assert.ok(w.hunters.length >= 1 && w.hunters.length <= 5, `about 4 hunters after one tick (${w.hunters.length})`);
});

test("ecosystem hunters: same seed, same run (populations, rounds, brains)", () => {
  const snap = (w: World) => JSON.stringify([w.eco.popHist, w.eco.hunterPopHist, w.eco.rounds, w.eco.caught, w.hunters.map((h) => [h.x, h.energy, h.brain!.g])]);
  const a = toEco(5);
  const b = toEco(5);
  runTicks(a, 3000);
  runTicks(b, 3000);
  assert.equal(snap(a), snap(b));
  assert.ok(a.eco.caught > 0, "they catch something");
});

test("ecosystem hunters: starving hunters end the round; the hunters restart from the best catchers", () => {
  const w = toEco(2, { hunterHunger: 0.4 }); // empty in 3 ticks unless they eat
  runTicks(w, 3);
  const r = w.eco.rounds[0];
  assert.ok(r && (r.died === "hunters" || r.died === "both"), JSON.stringify(w.eco.rounds));
  assert.equal(w.hunters.length, 4, "rules.hunters new hunters");
  assert.ok(w.hunters.every((h) => h.energy === 1 && h.age === 0));
});

test("ecosystem hunters: births stop at the safety cap", () => {
  const w = toEco(4, { hunterHunger: 0, hunterBirth: 0.001, hunterMature: 0, hunterBirthChance: 1 }); // every hunter splits every tick (a baby takes half: 10 halvings to go below 0.001)
  runTicks(w, 30);
  assert.equal(w.hunters.length, HUNTER_CAP);
});

test("ecosystem hunters: hunters die of old age", () => {
  const w = toEco(6, { hunterHunger: 0, hunterAge: 50, hunterBirth: 2 }); // no hunger, no babies
  runTicks(w, 49);
  assert.equal(w.eco.hunterOldAge, 0);
  runTicks(w, 2);
  assert.equal(w.eco.hunterOldAge, 4, "the first 4 died at age 50");
});

test("ecosystem hunters: when all prey die, prey restart from the longest-lived brains", () => {
  const w = toEco(7, { energyCost: 400 }); // prey starve within a few ticks
  const before = w.nextFamilyId;
  runTicks(w, 30);
  const r = w.eco.rounds.find((x) => x.died !== "hunters");
  assert.ok(r && (r.died === "prey" || r.died === "both"), JSON.stringify(w.eco.rounds));
  assert.ok(w.creatures.length > 0, "new prey");
  assert.ok(w.nextFamilyId > before, "each restart brain starts a family");
});

test("after a prey wipe the hunters are cut back to 4: the best, the 2 nearest the average (at or below), 1 new random", () => {
  const w = toEco(8, {});
  runTicks(w, 1);
  const catches = [5, 9, 2, 4, 9, 6, 1, 3]; // average 4.875: at or below it, nearest first: 4, 3, 2, 1
  w.hunters = catches.map((c, i) => ({ ...w.hunters[0], brain: { ...w.hunters[0].brain!, id: 100 + i, caught: c } }));
  thinHunters(w);
  assert.equal(w.hunters.length, 4);
  assert.deepEqual(w.hunters.slice(0, 3).map((h) => h.brain!.caught), [9, 4, 3], "the first 9 (earlier), then 4 and 3");
  assert.equal(w.hunters[0].brain!.id, 101);
  assert.equal(w.hunters[3].brain!.origin, "random");
  assert.equal(w.hunters[3].brain!.caught, 0);
});

test("ecosystem hunters: no babies before rules.hunterMature", () => {
  const w = toEco(9, { hunterHunger: 0, hunterBirth: 0.5, hunterMature: 40, hunterBirthChance: 1, hunterAge: 100000 });
  runTicks(w, 39); // a hunter's age goes up before the baby check: after tick k it is k, so 39 here
  assert.equal(w.eco.hunterBirths, 0, "all still young");
  runTicks(w, 2);
  assert.ok(w.eco.hunterBirths > 0, "adults now");
});

test("ecosystem hunters: older is harder; at old age no babies at all", () => {
  // fertility falls from 1 at maturity to 0 at hunterAge: with chance 1, a full hunter just grown up always
  // has a baby; one 1 tick before old age almost never does
  const w = toEco(9, { hunterHunger: 0, hunterBirth: 0.5, hunterMature: 0, hunterBirthChance: 1, hunterAge: 1000 });
  runTicks(w, 1);
  for (const h of w.hunters) { h.age = 999; h.energy = 1.5; }
  const births = w.eco.hunterBirths;
  liveEcoHunters(w); // age becomes 1000 = hunterAge: fertility 0 -> no babies, and they die of old age
  assert.equal(w.eco.hunterBirths, births);
});

// Eye on (rules.eye): prey brains read the eye, hunter brains keep the old "nearest X" layout and never
// borrow a prey brain (the shapes differ). Found 2026-11-01 before the life-mode test: ecosystem hunters
// always have brains, and they were sized by the prey's input count.
const EYE_ECO = { ...DEFAULT_RULES, mode: 1, ecoWarmup: 0, eye: 4, hunters: 4, food: 60, foodSpread: 0.0005, regrow: 100, poison: 0.3, senseFood2: 1, senseCreature: 1, senseGenes: 1, senseCost: 0.0002 };
const hunterShapeOk = (w: World) => {
  const n = hunterInputCount(w.rules), len = genomeSize(n, w.rules.hidden);
  for (const h of w.hunters) {
    assert.equal(h.brain!.g.length, len);
    assert.equal(h.brain!.inputs.length, n);
    assert.equal(h.brain!.origin, "random");
  }
};

test("eye + ecosystem: hunters keep the old input layout, start random, same seed same run", () => {
  assert.notEqual(hunterInputCount(EYE_ECO), inputCount(EYE_ECO), "the two layouts really differ");
  assert.equal(hunterInputCount(EYE_ECO), inputCount({ ...EYE_ECO, eye: 0 }));
  const a = createWorld(3, EYE_ECO), b = createWorld(3, EYE_ECO);
  runTicks(a, 3000);
  runTicks(b, 3000);
  assert.ok(a.eco.hunterBirths + a.hunters.length > 0, "hunters took part");
  hunterShapeOk(a);
  assert.equal(JSON.stringify([a.hunters.map((h) => [h.x, h.y, h.brain!.g]), a.creatures.map((c) => c.g)]),
    JSON.stringify([b.hunters.map((h) => [h.x, h.y, h.brain!.g]), b.creatures.map((c) => c.g)]));
});

test("eye + generations: first brain hunters are all random even with extinct families", () => {
  const w = createWorld(2, { ...SMALL, eye: 4, hunters: 5, hunterPool: 5, hunterFrom: 1000 });
  runGenerations(w, 6);
  assert.ok(w.legacy.length >= 3, `enough extinct families for the test (${w.legacy.length})`);
  const first = firstHunterBrains(w);
  assert.ok(first.every((h) => h.origin === "random"));
  for (const h of first) assert.equal(h.g.length, genomeSize(hunterInputCount(w.rules), w.rules.hidden));
});

// Hunter eye + motion (Rey 2026-11-02): hunters see prey, prey motion and hunters with a raw eye; prey see how
// fast hunters move. Shapes, determinism, and the sick-prey cue (slow prey = weak motion).
const BOTH_EYES = { ...EYE_ECO, hunterEye: 4, eyeMotion: 1 };

test("hunter eye + motion: shapes match, same seed same run", () => {
  assert.equal(hunterInputCount(BOTH_EYES), 4 * 3 + 1);
  assert.equal(inputCount(BOTH_EYES), 4 * 5 + 1);
  const a = createWorld(3, BOTH_EYES), b = createWorld(3, BOTH_EYES);
  runTicks(a, 3000);
  runTicks(b, 3000);
  hunterShapeOk(a);
  for (const c of a.creatures) assert.equal(c.inputs.length, inputCount(BOTH_EYES));
  assert.equal(JSON.stringify([a.hunters.map((h) => [h.x, h.y, h.brain!.g]), a.creatures.map((c) => c.g)]),
    JSON.stringify([b.hunters.map((h) => [h.x, h.y, h.brain!.g]), b.creatures.map((c) => c.g)]));
});

test("hunter eye: a slow (sick) prey shows the same in 'prey' but weaker in 'prey motion'", () => {
  const w = createWorld(3, BOTH_EYES);
  runTicks(w, 1);
  const h = w.hunters[0];
  const c = w.creatures[0];
  w.creatures = [c];
  w.hunters = [h];
  c.x = h.x + 50; c.y = h.y; c.alive = true; // straight ahead of a hunter facing +x (cosH 1, sinH 0)
  const inputs = new Array(13).fill(0);
  const read = (speed: number) => { c.speed = speed; hunterEyeInto(w, h, inputs, 1, 0, 4, BOTH_EYES.walls > 0, true); return [...inputs]; };
  const fast = read(3), slow = read(0.75);
  const sl = fast.slice(0, 4).findIndex((v) => v > 0);
  assert.ok(sl >= 0, "the prey is in some slice");
  assert.equal(fast[sl], slow[sl]);
  assert.ok(Math.abs(slow[4 + sl] - fast[4 + sl] / 4) < 1e-12);
});

// Remains (Rey 2026-11-02): a dying prey leaves food that carries its poison; it rots after rules.remains ticks.
test("remains: dead prey leave food with their poison, eaten or rotted remains leave, same seed same run", () => {
  const R = { ...EYE_ECO, remains: 300 };
  const a = createWorld(3, R), b = createWorld(3, R);
  runTicks(a, 3000);
  runTicks(b, 3000);
  assert.ok(a.eco.deaths > 0, "some prey died");
  const rem = a.food.filter((f) => f.remains);
  assert.ok(rem.length > 0, "remains on the map");
  for (const f of rem) {
    assert.ok(f.until! > a.tick && f.readyAt !== Infinity, "no rotted or eaten remains kept");
    assert.ok(f.until! - 300 <= a.tick);
  }
  assert.ok(a.eco.remainsEaten > 0, "prey ate some remains");
  assert.equal(JSON.stringify([a.food, a.creatures.map((c) => c.g), a.eco.remainsEaten]), JSON.stringify([b.food, b.creatures.map((c) => c.g), b.eco.remainsEaten]));
  const off = createWorld(3, EYE_ECO);
  runTicks(off, 3000);
  assert.equal(off.food.filter((f) => f.remains).length, 0);
});

// Trained hunter resistance with a cap and its own inheritance (Rey 2026-11-02: b, cap 0.5, babies get 25%).
// Breeding resistance by hand (Rey 2026-11-02, c): generations mode, the judge pays for poison, so the gene rises;
// off = no gene, no extra random draws (old runs unchanged).
test("hunter resistance gene: bred up when every prey is poisoned; off leaves it at 0", () => {
  // full-size world: in SMALL (pop 20, 300 ticks) too few catches per map, so luck beats the poison cost
  const on = createWorld(5, { ...DEFAULT_RULES, hunters: 4, hunterBrains: 1, hunterFrom: 1, hunterResistGene: 1, genPreyToxin: 1 });
  runGenerations(on, 10);
  const r = on.hunterHist.at(-1)!.resist!;
  assert.ok(r > 0.5, `resistance bred up (${r.toFixed(2)})`);
  const off = createWorld(1, { ...SMALL, hunterFrom: 1 });
  runGenerations(off, 5);
  assert.ok(off.hunterBrains.every((b) => b.resistGene === 0));
  assert.equal(off.hunterHist.at(-1)!.resist, undefined);
});

test("hunterResistSlow: a fully resistant hunter moves at most (1 - slow) x top speed", () => {
  const w = createWorld(1, { ...SMALL, hunterFrom: 1, hunterResistGene: 1, hunterResistSlow: 0.5 });
  for (const b of w.hunterBrains) b.resistGene = 1;
  let top = 0;
  for (let t = 0; t < 200; t++) { runTicks(w, 1); for (const h of w.hunters) top = Math.max(top, h.speed); }
  assert.ok(top > 0, "hunters moved");
  assert.ok(top <= 0.5 * w.rules.hunterSpeed + 1e-12, `top speed ${top}`);
});

// Bite choice (Rey 2026-11-02): a prey in reach is caught only if the hunter's bite output is above 0.
// Dose cap (Rey 2026-11-02, a): a hunter takes at most hunterDoseCap poison from one prey.
test("hunterDoseCap: no single catch adds more than the cap to a hunter's poison", () => {
  const w = createWorld(1, { ...BOTH_EYES, hunterDoseCap: 0.7 });
  let maxStep = 0;
  for (let t = 0; t < 20000; t++) {
    const before = new Map(w.hunters.map((h) => [h, h.toxin]));
    runTicks(w, 1);
    for (const h of w.hunters) if (before.has(h)) maxStep = Math.max(maxStep, h.toxin - before.get(h)!);
  }
  const poisoned = w.eco.dose.n.slice(1).reduce((a, b) => a + b, 0);
  assert.ok(poisoned > 0, "some poisoned prey were caught");
  assert.ok(maxStep > 0.3 && maxStep <= 0.7 + 1e-9, `largest one-tick rise ${maxStep}`);
});

// Hunter forgetting (Rey 2026-11-03): learned changes fade back toward the inborn brain.
test("forget (shared with prey) also applies to hunters: learned weights stay much closer to the inborn brain", () => {
  const drift = (forget: number) => {
    const w = createWorld(1, { ...BOTH_EYES, relativeReward: 0, forget });
    runTicks(w, 8000);
    let d = 0, n = 0;
    for (const h of w.hunters) { const b = h.brain!; for (let k = 0; k < b.w.length; k++) { d += Math.abs(b.w[k] - b.g[k]); n++; } }
    return d / Math.max(1, n);
  };
  const free = drift(0), held = drift(0.05); // measured seed 1, 8k ticks: 1.85 vs 0.35 (0.002 only gets 1.45)
  assert.ok(free > 0, "hunters learned something");
  assert.ok(held < free / 2, `drift with forgetting ${held} vs without ${free}`);
});

// Relative reward for hunters (Rey 2026-11-03, b): learning from "better or worse than usual" does not pile up.
test("relativeReward + slow forget (shared with prey) apply to hunters: learned weights drift far less than raw reward + same forgetting", () => {
  // relative reward alone stops the steady push but not a random walk (screen: drift 1.87 vs 1.85, catches 285 vs 137);
  // with prey's slow forgetting (0.002) as well, drift falls to 0.59 (forgetting 0.002 alone: 1.45)
  const drift = (rel: number) => {
    const w = createWorld(1, { ...BOTH_EYES, relativeReward: rel, forget: 0.002 });
    runTicks(w, 8000);
    let d = 0, n = 0;
    for (const h of w.hunters) { const b = h.brain!; for (let k = 0; k < b.w.length; k++) { d += Math.abs(b.w[k] - b.g[k]); n++; } }
    return d / Math.max(1, n);
  };
  const raw = drift(0), rel = drift(1);
  assert.ok(rel > 0, "hunters still learn");
  assert.ok(rel < raw / 2, `drift relative ${rel} vs raw ${raw}`);
});

test("zero point (counting only): every catch with other prey around adds a sick share between 0 and 1, near shares counted in nested circles", () => {
  const w = createWorld(1, { ...BOTH_EYES, poison: 0.3 });
  runTicks(w, 6000);
  const z = w.eco.dose.zero;
  assert.equal(z.length, 10);
  assert.ok(z[0] > 20, `catches counted: ${z[0]}`);
  assert.ok(z[0] <= w.eco.caught, "never more than all catches");
  for (const [n, sum] of [[z[0], z[1]], [z[2], z[3]], [z[4], z[5]], [z[6], z[7]], [z[8], z[9]]]) assert.ok(sum >= 0 && sum <= n, `share sum ${sum} within 0..${n}`);
  assert.ok(z[8] <= z[6] && z[6] <= z[2] && z[2] <= z[4] && z[4] <= z[0], "fewer catches have others within 12 px than 25 px than 50 px than 200 px than anywhere");
  assert.ok(z[8] > 0, `catches with another prey within 12 px: ${z[8]}`);
  const again = createWorld(1, { ...BOTH_EYES, poison: 0.3 });
  runTicks(again, 6000);
  assert.deepEqual(again.eco.dose.zero, z, "same seed, same counts");
});

// rules.hunterCue (Rey 2026-11-06): what a hunter sees of sickness: speed or glow.

test("hunterCue 2 (glow): the hunter eye's 2nd channel reads closeness x min(poison, 1), whatever the prey's speed; 1 still reads speed", () => {
  const read = (cue: number, toxin: number, speed: number) => {
    const R = { ...BOTH_EYES, hunterCue: cue };
    const w = createWorld(3, R);
    runTicks(w, 1);
    const h = w.hunters[0], c = w.creatures[0];
    w.creatures = [c]; w.hunters = [h];
    c.x = h.x + 50; c.y = h.y; c.alive = true; c.toxin = toxin; c.speed = speed;
    const inputs = new Array(13).fill(0);
    hunterEyeInto(w, h, inputs, 1, 0, 4, R.walls > 0, true);
    return inputs;
  };
  const v = 1 - (50 * 50) / (200 * 200);
  const sick = read(2, 0.5, 3), clean = read(2, 0, 0), heavy = read(2, 4, 3);
  const sl = sick.slice(0, 4).findIndex((x) => x > 0);
  assert.ok(Math.abs(sick[4 + sl] - v * 0.5) < 1e-12, `glow of a fast half-poisoned prey: ${sick[4 + sl]}`);
  assert.equal(clean[4 + sl], 0, "a slow clean prey does not glow");
  assert.ok(Math.abs(heavy[4 + sl] - v) < 1e-12, "glow tops out at 1");
  const speed = read(1, 0.5, 1.5);
  assert.ok(Math.abs(speed[4 + sl] - v * 0.5) < 1e-12, "hunterCue 1 still reads speed / 3");
  const blind = read(0, 0.5, 1.5);
  assert.equal(blind.slice(4, 8).reduce((a, b) => a + b, 0), 0, "hunterCue 0: the cue channel is empty");
});

// rules.season (Rey 2026-11-09): four seasons: foraging, poison foraging, farm, poison farm. The number of plants does not change at a turn.
import { seasonFactor, seasonQuarter, farmSeason, SEASON_SWING, FARM_R, FARMS } from "../src/engine/plants.ts";

test("season: foraging, poison foraging, farm, poison farm; plants change kind and place at the turns, their number does not", () => {
  const R = { ...EYE_ECO, season: 2000 }; // quarters of 500 ticks
  const w = createWorld(4, R);
  const plants = () => w.food.filter((f) => !f.remains);
  const share = () => plants().filter((f) => f.poison).length / plants().length;
  const off = (v: number, size: number) => { const d = Math.abs(v) % size; return R.walls > 0 ? Math.abs(v) : Math.min(d, size - d); };
  const inFarm = (f: { x: number; y: number }) => { for (let k = 0; k < FARMS; k++) if (Math.hypot(off(f.x - w.eco.farms[2 * k], 800), off(f.y - w.eco.farms[2 * k + 1], 600)) <= FARM_R + 26) return true; return false; };
  runTicks(w, 2);
  assert.equal(seasonQuarter(w), 0);
  assert.equal(seasonFactor(w), 1 - SEASON_SWING, "the year starts clean");
  assert.ok(share() < 0.03, `foraging: poison share ${share()}`);
  assert.equal(w.eco.farms.length, 0, "no farms drawn before the first farm season");
  runTicks(w, 497 - w.tick);
  const before = plants().length;
  runTicks(w, 5);
  assert.equal(seasonQuarter(w), 1);
  assert.ok(Math.abs(plants().length - before) <= 3, `plants at the turn: ${before} -> ${plants().length}`);
  assert.ok(Math.abs(share() - R.poison * (1 + SEASON_SWING)) < 0.06, `poison foraging: poison share ${share()}`);
  runTicks(w, 1003 - w.tick);
  assert.ok(farmSeason(w) && seasonQuarter(w) === 2);
  assert.equal(w.eco.farms.length, 2 * FARMS);
  assert.ok(share() < 0.03, "farm: clean again");
  assert.equal(plants().filter((f) => !inFarm(f)).length, 0, "farm: every plant stands in a farm (sprouts land within 25 px)");
  runTicks(w, 1503 - w.tick);
  assert.equal(seasonQuarter(w), 3);
  assert.ok(share() > 0.4, `poison farm: poison share ${share()}`);
  assert.ok(plants().filter(inFarm).length / plants().length > 0.9, "poison farm: plants still in the farms");
  runTicks(w, 2003 - w.tick);
  assert.equal(seasonQuarter(w), 0);
  assert.ok(plants().filter(inFarm).length / plants().length < 0.6, "next year: the plants are spread over the map again");
  const a = createWorld(4, R), b = createWorld(4, R);
  runTicks(a, 3000); runTicks(b, 3000);
  assert.deepEqual(a.eco.popHist, b.eco.popHist, "same seed, same run");
  const none = createWorld(4, EYE_ECO);
  assert.equal(seasonFactor(none), 1, "off: no season");
});

// rules.hunterBite (restored 2026-11-09, Rey: "choice"): a third hunter output; a prey in reach is caught only if the bite says yes.
test("hunterBite: genome carries the bite weights; a hunter whose bite is always no never catches; off = no extra weights", () => {
  const R = { ...BOTH_EYES, hunterBite: 1, hunterCue: 2 };
  const a = createWorld(3, R);
  runTicks(a, 2000);
  const len = genomeSize(hunterInputCount(R), R.hidden) + R.hidden + 1;
  for (const h of a.hunters) assert.equal(h.brain!.g.length, len);
  assert.ok(a.eco.dose.biteClean[0] > a.eco.dose.biteClean[1], "the start bias makes most hunters bite");
  const b = createWorld(3, R);
  runTicks(b, 2000);
  assert.equal(JSON.stringify(a.hunters.map((h) => h.brain!.g)), JSON.stringify(b.hunters.map((h) => h.brain!.g)), "same seed, same run");
  const n = createWorld(3, R);
  runTicks(n, 1);
  for (const h of n.hunters) h.brain!.g[h.brain!.g.length - 1] = -100; // bias: never bite
  const caught = n.eco.caught, rounds = n.eco.rounds.length;
  runTicks(n, 200); // shorter than a hunter can starve (energy 1 / hunger 0.0025 = 400 ticks), so no restart brings new brains
  assert.equal(n.eco.rounds.length, rounds, "no restart in between");
  assert.ok(n.eco.dose.biteSick[1] + n.eco.dose.biteClean[1] > 0, "prey came into reach and were refused");
  assert.equal(n.eco.caught, caught, "nobody was caught");
  const off = createWorld(3, { ...BOTH_EYES, hunterCue: 2 });
  runTicks(off, 50);
  for (const h of off.hunters) assert.equal(h.brain!.g.length, len - R.hidden - 1, "bite off: the plain brain");
});

// rules.hunterPoisonHalfLife (Rey 2026-11-10: "bigger metabolism, faster poison degrade"): poison fades faster in hunters than in prey.
import { fadeHunter, fade } from "../src/engine/toxin.ts";

test("hunterPoisonHalfLife: a hunter's poison halves in its own half-life; 0 = the prey's", () => {
  const w = createWorld(2, { ...BOTH_EYES, hunterPoisonHalfLife: 50 });
  let lv = 8;
  for (let t = 0; t < 50; t++) lv = fadeHunter(lv, w);
  assert.ok(Math.abs(lv - 4) < 0.05, `after 50 ticks: ${lv}`);
  let prey = 8;
  for (let t = 0; t < 50; t++) prey = fade(prey, w);
  assert.ok(prey > 7, `prey keep their 500-tick half-life: ${prey}`);
  const off = createWorld(2, BOTH_EYES);
  assert.equal(fadeHunter(3, off), fade(3, off), "off: the same as prey");
  const a = createWorld(2, { ...BOTH_EYES, hunterPoisonHalfLife: 50 }), b = createWorld(2, { ...BOTH_EYES, hunterPoisonHalfLife: 50 });
  runTicks(a, 3000); runTicks(b, 3000);
  assert.deepEqual(a.eco.hunterPopHist, b.eco.hunterPopHist, "same seed, same run");
});

// rules.hunterIdle (Rey 2026-11-11): standing still costs a hunter less hunger than chasing, so waiting for a better prey is affordable.
test("hunterIdle: a still hunter pays that share of its hunger, a hunter at top speed all of it; off = the same at any speed", () => {
  const drop = (rules: Partial<typeof DEFAULT_RULES>, speed: number) => {
    const w = createWorld(2, { ...BOTH_EYES, ...rules });
    runTicks(w, 5);
    const h = w.hunters[0];
    h.energy = 0.5; h.toxin = 0; h.age = 1; h.speed = speed;
    liveEcoHunters(w);
    return 0.5 - h.energy;
  };
  const hunger = DEFAULT_RULES.hunterHunger, top = DEFAULT_RULES.hunterSpeed;
  assert.ok(Math.abs(drop({ hunterIdle: 0.25 }, 0) - hunger * 0.25) < 1e-12, "still: a quarter");
  assert.ok(Math.abs(drop({ hunterIdle: 0.25 }, top) - hunger) < 1e-12, "top speed: all of it");
  assert.ok(Math.abs(drop({ hunterIdle: 0.25 }, top / 2) - hunger * 0.625) < 1e-12, "half speed: in between");
  assert.equal(drop({}, 0), drop({}, top), "off: the same at any speed");
});

// rules.resistGene (Rey 2026-11-10, built 2026-11-11): inborn poison resistance, inherited with a nudge, with an upkeep.
import { babyResist, harm as harmOf } from "../src/engine/toxin.ts";

test("resistGene: a hunter baby inherits its parent's resistance, resistance has an upkeep and cuts harm; off = no resistance", () => {
  const run = (gene: number) => {
    const w = createWorld(2, { ...BOTH_EYES, resistGene: gene, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1, mutation: 0 });
    runTicks(w, 5);
    w.hunters.length = 1;
    const h = w.hunters[0];
    h.resist = 0.5; h.energy = 2; h.age = 1; h.toxin = 0; h.speed = 0;
    liveEcoHunters(w);
    assert.equal(w.hunters.length, 2, "one baby");
    return { baby: w.hunters[1].resist, parentEnergy: h.energy };
  };
  const on = run(0.4), off = run(0);
  assert.ok(on.baby !== 0.5 && Math.abs(on.baby - 0.5) < 0.2, `on: the baby has the parent's resistance plus a small nudge: ${on.baby}`);
  assert.equal(off.baby, 0, "off: babies have none");
  assert.ok(Math.abs(off.parentEnergy - on.parentEnergy - 0.4 * DEFAULT_RULES.hunterHunger * 0.5 / 2) < 1e-12, "upkeep: gene cost x resistance, paid before the split halves the energy");
  assert.equal(babyResist(0.95, 2), 1); assert.equal(babyResist(0.05, -2), 0);
  assert.equal(harmOf(2, 0.5), 1, "half resistance: half the harm");
  const a = createWorld(3, { ...BOTH_EYES, resistGene: 0.3 }), b = createWorld(3, { ...BOTH_EYES, resistGene: 0.3 });
  runTicks(a, 3000); runTicks(b, 3000);
  assert.deepEqual(a.eco.hunterPopHist, b.eco.hunterPopHist, "same seed, same run");
  assert.ok(a.creatures.some((c) => c.resist > 0), "prey babies carry resistance after 3000 ticks");
});

// rules.digest (Rey 2026-11-11: "a digest bar ... just consumption, works for prey and hunter"; poison seeps in while digesting).
import { digestTick, hasRoom, swallow, PELLET, PREY_GUT, hunterDigest, preyDigest, fullness } from "../src/engine/gut.ts";

test("digest: a stomach hands its energy and poison to the body bit by bit, loses nothing, and a full one takes no more", () => {
  const e = { energy: 0.5, toxin: 0 } as { energy: number; toxin: number; gut?: { bulk: number; energy: number; toxin: number } };
  assert.ok(hasRoom(e, 0.5, 0.5), "empty: room for a meal");
  swallow(e, 0.5, 0.5, 2);
  assert.ok(!hasRoom(e, 0.5, 0.5), "one meal in: a hunter's stomach is full");
  assert.equal(fullness(e, 0.5), 1, "it feels full");
  assert.equal(e.energy, 0.5, "nothing reaches the body at the bite");
  digestTick(e, 0.005, 1.5);
  assert.ok(Math.abs(e.energy - 0.505) < 1e-12 && Math.abs(e.toxin - 0.02) < 1e-12, `one tick: 1% of the meal and of its poison (${e.energy}, ${e.toxin})`);
  for (let t = 0; t < 120; t++) digestTick(e, 0.005, 1.5);
  assert.ok(Math.abs(e.energy - 1) < 1e-9 && Math.abs(e.toxin - 2) < 1e-9 && e.gut!.bulk === 0, "after 100 ticks all of it arrived, nothing lost");
  assert.ok(hasRoom(e, 0.5, 0.5), "empty again");
  const full = { energy: 1.5, toxin: 0 } as typeof e;
  swallow(full, PELLET, PELLET, 0);
  digestTick(full, 0.005, 1.5);
  assert.equal(full.gut!.energy, PELLET, "a body at top energy waits: nothing is wasted");
  const prey = { energy: 1, toxin: 0 } as typeof e;
  swallow(prey, PELLET, 0, 1); swallow(prey, PELLET, PELLET, 0);
  assert.ok(!hasRoom(prey, PELLET, PREY_GUT), "a prey's stomach holds two pellets (a poison pellet takes room too)");
});

test("digest in the world: hunters and prey get stomachs, a full hunter does not catch, same seed same run; off = no stomachs", () => {
  const R = { ...BOTH_EYES, digest: 3 };
  const a = createWorld(3, R), b = createWorld(3, R);
  let seenFullHunter = false, caughtWhileFull = false;
  for (let t = 0; t < 3000; t++) {
    const before = a.hunters.map((h) => ({ h, full: !!h.gut && h.gut.bulk > 1e-9, c: h.brain!.caught }));
    runTicks(a, 1);
    for (const p of before) { if (p.full) { seenFullHunter = true; if (p.h.brain!.caught > p.c) caughtWhileFull = true; } }
  }
  runTicks(b, 3000);
  assert.ok(seenFullHunter && !caughtWhileFull, "hunters filled up, and none caught while full");
  assert.ok(a.creatures.some((c) => c.gut), "prey have stomachs");
  assert.equal(hunterInputCount(R), hunterInputCount(BOTH_EYES) + 1, "hunters get one more input: how full the stomach is");
  assert.equal(inputCount(R), inputCount(BOTH_EYES) + 1, "prey too");
  assert.ok(Math.abs(hunterDigest(R as never) - 3 * R.hunterHunger) < 1e-15 && Math.abs(preyDigest(R as never) - 3 * 0.0017) < 1e-15, "the rate is 3 x what each body burns");
  assert.deepEqual(a.eco.hunterPopHist, b.eco.hunterPopHist, "same seed, same run");
  const off = createWorld(3, BOTH_EYES);
  runTicks(off, 1000);
  assert.ok(off.creatures.every((c) => !c.gut) && off.hunters.every((h) => !h.gut), "off: nobody has a stomach");
});

// rules.seasonFarm (Rey 2026-11-11: seasons to make resistance useful): 0 = the poison still swings with the season, but no farm seasons.
import { farmRadius } from "../src/engine/plants.ts";
test("seasonFarm 0: the poison swings with the seasons but the plants are never packed into farms; 1 = farms as before", () => {
  const noFarm = createWorld(2, { ...BOTH_EYES, season: 2000, seasonFarm: 0 }), farm = createWorld(2, { ...BOTH_EYES, season: 2000 });
  const share: number[] = [];
  for (let q = 0; q < 4; q++) { runTicks(noFarm, 500); share.push(noFarm.food.filter((f) => f.poison).length / noFarm.food.length); }
  runTicks(farm, 1600);
  assert.equal(noFarm.eco.farms.length, 0, "no farms were ever made");
  assert.equal(farm.eco.farms.length, 2 * 2, "default: the farm season made its 2 farms");
  const many = createWorld(2, { ...BOTH_EYES, season: 2000, seasonFarm: 8 });
  runTicks(many, 1600);
  assert.equal(many.eco.farms.length, 2 * 8, "seasonFarm 8: eight scattered farms");
  assert.ok(Math.abs(farmRadius(8) - 55) < 1e-9 && farmRadius(2) === 110, "the same total area: 8 farms have radius 55");
  assert.ok(share[1] > share[0] + 0.1 && share[3] > share[2] + 0.1, `poison plants swing: ${share.map((x) => x.toFixed(2)).join(" / ")}`);
});

// rules.poisonRamp / poisonPeak (Rey 2026-11-13): the poison share of the plants starts at the normal world's own share, rises slowly to
// poisonPeak, then holds.
import { baseShare, rampShare } from "../src/engine/plants.ts";
test("poisonRamp: starts at the normal world's poison share, climbs to poisonPeak and holds; off = the steady world", () => {
  const R = { ...BOTH_EYES, poisonRamp: 4000, poisonPeak: 0.6 };
  const w = createWorld(2, R), off = createWorld(2, BOTH_EYES);
  const share = (x: typeof w) => { const p = x.food.filter((f) => !f.remains); return p.filter((f) => f.poison).length / p.length; };
  assert.ok(Math.abs(baseShare(w) - 54 / 234) < 1e-12, "the normal world: 54 poison of 234 plants");
  runTicks(w, 1000); runTicks(off, 1000);
  assert.ok(Math.abs(share(w) - share(off)) < 0.04, `starts normal: ${share(w).toFixed(2)} vs steady ${share(off).toFixed(2)}`);
  runTicks(w, 1000);
  assert.ok(Math.abs(rampShare(w) - (54 / 234 + (0.6 - 54 / 234) / 2)) < 1e-12, "half way: half the climb");
  runTicks(w, 3000); runTicks(off, 4000);
  assert.ok(Math.abs(share(w) - 0.6) < 0.06, `held at the peak: ${share(w).toFixed(2)}`);
  assert.ok(Math.abs(share(off) - 54 / 234) < 0.06, `off: the steady share: ${share(off).toFixed(2)}`);
});

// rules.hunterEarlyBreed / hunterHangover (Rey 2026-11-13): poison lets a hunter breed early; when it wears off, a sense is dulled.
import { hangoverTick, hungOver } from "../src/engine/hunters.ts";
test("hunterEarlyBreed: a poisoned hunter has its baby at lower energy; a clean one and off = the usual energy", () => {
  const babies = (early: number, toxin: number) => {
    const w = createWorld(2, { ...BOTH_EYES, hunterEarlyBreed: early, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1 });
    runTicks(w, 5);
    w.hunters.length = 1;
    const h = w.hunters[0];
    h.energy = 1.0; h.age = 1; h.toxin = toxin;
    liveEcoHunters(w);
    return w.hunters.length - 1;
  };
  assert.equal(babies(0.3, 1), 1, "poisoned, early breeding on: 1.0 energy is enough (the bar is 0.84)");
  assert.equal(babies(0.3, 0), 0, "clean: the bar stays 1.2");
  assert.equal(babies(0, 1), 0, "off: the bar stays 1.2");
});
test("hunterHangover: poison no longer raises hunger; after it wears off the hangover lasts as long as the poison did", () => {
  const w = createWorld(2, { ...BOTH_EYES, hunterHangover: 3 }), off = createWorld(2, BOTH_EYES);
  const drop = (x: typeof w) => { runTicks(x, 5); x.hunters.length = 1; const h = x.hunters[0]; h.energy = 0.5; h.age = 1; h.toxin = 1; h.speed = 0; liveEcoHunters(x); return 0.5 - h.energy; };
  assert.ok(Math.abs(drop(w) - DEFAULT_RULES.hunterHunger) < 1e-12, "on: plain hunger");
  assert.ok(Math.abs(drop(off) - 2 * DEFAULT_RULES.hunterHunger) < 1e-12, "off: hunger x (1 + poison)");
  const h = { toxin: 1, resist: 0 } as World["hunters"][number];
  for (let t = 0; t < 40; t++) hangoverTick(h);
  assert.ok(!hungOver(h) && h.high === 40, "while poisoned: no hangover yet, the bill grows");
  h.toxin = 0; hangoverTick(h);
  assert.ok(hungOver(h) && h.hang === 40, "it wore off: a hangover as long as the poison lasted");
  for (let t = 0; t < 40; t++) hangoverTick(h);
  assert.ok(!hungOver(h), "and then it is over");
  const res = { toxin: 1, resist: 1 } as World["hunters"][number];
  hangoverTick(res);
  assert.ok(!res.high, "a fully resistant hunter feels nothing");
  const a = createWorld(3, { ...BOTH_EYES, hunterHangover: 3, hunterEarlyBreed: 0.3 }), b = createWorld(3, { ...BOTH_EYES, hunterHangover: 3, hunterEarlyBreed: 0.3 });
  runTicks(a, 3000); runTicks(b, 3000);
  assert.deepEqual(a.eco.hunterPopHist, b.eco.hunterPopHist, "same seed, same run");
});

// rules.safePrey (Rey 2026-11-20, a check): a share of prey of a safe kind that never eats poison plants; the kind is inherited.
test("safePrey: the safe kind never gets poisoned, its share stays near safePrey; off = one kind", () => {
  const R = { ...BOTH_EYES, safePrey: 0.5 };
  const w = createWorld(2, R);
  assert.equal(w.creatures.filter((c) => c.safe).length, Math.round(0.5 * w.creatures.length), "half the founders are safe");
  const ids = new Set(w.creatures.map((c) => c.id));
  runTicks(w, 4000);
  const safe = w.creatures.filter((c) => c.safe), share = safe.length / w.creatures.length;
  assert.ok(safe.length > 0 && safe.every((c) => c.toxin === 0 && c.poisoned === 0), `safe prey alive: ${safe.length}, all clean`);
  assert.ok(safe.some((c) => !ids.has(c.id)), "safe babies were born");
  assert.ok(share > 0.25 && share < 0.75, `the share stays near half: ${share.toFixed(2)}`);
  const off = createWorld(2, BOTH_EYES);
  assert.ok(off.creatures.every((c) => !c.safe), "off: no safe kind");
});

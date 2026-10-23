// Hunters with brains (P2): deterministic, borrowed brains really come from extinct families, arrival
// at rules.hunterFrom, and turning brains on doesn't touch the prey's random numbers before then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, runGenerations, DEFAULT_RULES, type World } from "../src/engine/world.ts";
import { firstHunterBrains } from "../src/engine/hunters.ts";
import { genomeSize } from "../src/engine/brain.ts";
import { inputCount } from "../src/engine/senses.ts";
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

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

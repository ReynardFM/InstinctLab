// Stage 3b: playing a generation's food maps on separate threads gives exactly the same run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, runGenerations, startLayout, tickLayout, DEFAULT_RULES, type Rules, type World } from "../src/engine/world.ts";
import { LayoutPool, runGenerationsSplit } from "../src/cli/split.ts";

const summary = (w: World) => ({
  avg: w.avgHist, best: w.bestHist, worst: w.worstHist, top: w.topHalfHist, poison: w.poisonHist,
  genomes: w.creatures.map((c) => c.g), families: [...w.families.keys()], splits: w.splits,
});

async function compare(rules: Rules, gens: number, threads: number): Promise<void> {
  const one = createWorld(7, rules);
  runGenerations(one, gens);
  const split = createWorld(7, rules);
  const pool = new LayoutPool(threads);
  try {
    await runGenerationsSplit(split, gens, pool);
  } finally {
    await pool.close();
  }
  assert.deepEqual(summary(split), summary(one));
}

test("split: maps on 3 threads = maps one after another (default rules)", async () => {
  await compare({ ...DEFAULT_RULES, genTicks: 600 }, 4, 3);
});

test("split: fewer threads than maps, extra senses, walls, newcomers, centre brain", async () => {
  await compare({ ...DEFAULT_RULES, genTicks: 500, senseFood2: 1, walls: 1, centreShare: 0.5, layouts: 4 }, 3, 2);
});

test("split: with learning on (each map starts from the inborn brain; children inherit the last map's learning)", async () => {
  await compare({ ...DEFAULT_RULES, genTicks: 500, learnRate: 0.01, plasticity: 1, swapKinds: 1, poison: 0.5 }, 3, 3);
});

test("each food map starts the same way whatever came before it", () => {
  const a = createWorld(3, DEFAULT_RULES);
  const b = createWorld(3, DEFAULT_RULES);
  for (let i = 0; i < 300; i++) tickLayout(b); // b plays 300 ticks of map 1 (eating, food respawning); a doesn't
  assert.ok(b.creatures.some((c) => c.eaten > 0), "b really played");
  b.layout = 2;
  a.layout = 2;
  startLayout(a);
  startLayout(b);
  assert.deepEqual(a.food, b.food);
  assert.deepEqual(a.creatures.map((c) => [c.x, c.y, c.a]), b.creatures.map((c) => [c.x, c.y, c.a]));
});

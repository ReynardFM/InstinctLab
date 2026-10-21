// The grid search (engine/space.ts Grid) must give exactly the same answers as checking everything.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../src/engine/rng.ts";
import { Grid, SPATIAL, nearest, nearestOne, W, H } from "../src/engine/space.ts";
import { scanFood, scanFoodGrid } from "../src/engine/senses.ts";
import { createWorld, runGenerations, runTicks, DEFAULT_RULES, type World } from "../src/engine/world.ts";
import { CASES, firstDifference, runCase } from "../src/check/golden.ts";
import { readFileSync } from "node:fs";

const saved = { ...SPATIAL };
after(() => Object.assign(SPATIAL, saved));
const forceGrid = () => Object.assign(SPATIAL, { on: true, foodFrom: 0, creaturesFrom: 0 });
const noGrid = () => Object.assign(SPATIAL, { on: false });

test("grid: nearest item = brute force, for random points, walls or wrap-around, ties included", () => {
  const rng = createRng(5);
  for (const walls of [false, true]) {
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rng.next() * 60);
      // positions on a coarse lattice so equal distances (ties) happen often; walls allow x = W exactly
      const items = Array.from({ length: n }, () => ({
        x: Math.floor(rng.next() * 17) * (W / 16) * (walls ? 1 : 0.999),
        y: Math.floor(rng.next() * 13) * (H / 12) * (walls ? 1 : 0.999),
        alive: rng.next() < 0.8,
      }));
      const grid = new Grid();
      grid.build(items);
      const x = rng.next() * W;
      const y = rng.next() * H;
      const skip = items[0];
      const want = nearest(items, x, y, walls, 1, (o) => o === skip || !o.alive)[0];
      const got = nearestOne(grid, items, x, y, walls, skip, true);
      assert.deepEqual(got, want, `trial ${trial}, walls ${walls}`);
    }
  }
});

test("grid: food scan = one-pass scan (1 or 2 nearest food, nearest poison, regrowing pellets skipped)", () => {
  forceGrid();
  for (const rules of [
    { ...DEFAULT_RULES, food: 150, regrow: 50 },
    { ...DEFAULT_RULES, food: 40, poison: 0, walls: 1 },
    { ...DEFAULT_RULES, food: 90, poison: 0.5, swapKinds: 1, senseFood2: 1 },
  ]) {
    const w = createWorld(3, rules);
    runTicks(w, 200); // food eaten and regrowing
    const rng = createRng(9);
    for (let q = 0; q < 300; q++) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      const k = rules.senseFood2 ? 2 : 1;
      const grid = new Grid();
      grid.build(w.food);
      const poisonLooks = w.food.filter((f) => f.poison !== w.swapped).length;
      const g = { food: grid, creatures: new Grid(), foodOn: true, creaturesOn: false, poisonLooks };
      assert.deepEqual(scanFoodGrid(w, g, x, y, k), scanFood(w, x, y, k));
    }
  }
  Object.assign(SPATIAL, saved);
});

test("grid forced on for everything: every recorded run is unchanged", () => {
  forceGrid();
  const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
  for (const c of CASES) assert.equal(firstDifference(runCase(c), golden[c.name]), null, `case ${c.name}`);
  Object.assign(SPATIAL, saved);
});

test("grid on or off: big worlds and a crowded ecosystem run identically", () => {
  const summary = (w: World) => JSON.stringify([w.avgHist, w.eco.popHist, w.creatures.map((c) => c.g)]);
  for (const [rules, go] of [
    [{ ...DEFAULT_RULES, pop: 150, food: 200, genTicks: 300 }, (w: World) => runGenerations(w, 2)],
    [{ ...DEFAULT_RULES, mode: 1, regrow: 30, food: 200, ecoWarmup: 1, genTicks: 400 }, (w: World) => runTicks(w, 4000)],
  ] as const) {
    noGrid();
    const a = createWorld(4, rules);
    go(a);
    forceGrid();
    const b = createWorld(4, rules);
    go(b);
    assert.equal(summary(b), summary(a));
  }
  Object.assign(SPATIAL, saved);
});

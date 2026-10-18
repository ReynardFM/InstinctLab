import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brainDistance, createWorld, founderHue, hueDrift, retire, runGenerations, step, wrapDelta, DEFAULT_RULES, LEGACY_LIMIT } from "../src/engine/world.ts";
import { think, genomeSize, GENOME } from "../src/engine/brain.ts";
import { nearest } from "../src/engine/space.ts";
import { inputCount, inputLabels, wallAhead } from "../src/engine/senses.ts";
import { createRng, seedFrom } from "../src/engine/rng.ts";

// Numbers recorded from the single-file browser version before the TypeScript split.
// If these still match, the split changed nothing about how evolution behaves.
// the rules before food layouts, extra senses and newcomers existed
const ONE = { ...DEFAULT_RULES, layouts: 1, senseFood2: 0, senseCreature: 0, walls: 0, newcomers: 0 };
const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));

test("matches the original browser version exactly", () => {
  for (const seedText of ["42", "7", "hello"]) {
    const w = createWorld(seedFrom(seedText), ONE);
    runGenerations(w, 10);
    assert.deepEqual(w.avgHist, golden[seedText].avg, `avg, seed ${seedText}`);
    assert.deepEqual(w.bestHist, golden[seedText].best, `best, seed ${seedText}`);
  }
  const custom = { ...ONE, pop: 15, food: 20, elite: 0, parents: 50, mutation: 0.4, genTicks: 400 };
  const w = createWorld(42, custom);
  runGenerations(w, 10);
  assert.deepEqual(w.avgHist, golden.custom.avg);
});

test("same seed, same run; different seed, different run", () => {
  const a = createWorld(5, ONE);
  const b = createWorld(5, ONE);
  const c = createWorld(6, ONE);
  for (const w of [a, b, c]) runGenerations(w, 5);
  assert.deepEqual(a.avgHist, b.avgHist);
  assert.notDeepEqual(a.avgHist, c.avgHist);
});

test("two worlds running side by side don't affect each other", () => {
  const alone = createWorld(9, ONE);
  runGenerations(alone, 3);
  const x = createWorld(9, ONE);
  const noise = createWorld(10, ONE);
  for (let i = 0; i < 3 * ONE.genTicks; i++) {
    step(x);
    step(noise);
  }
  assert.deepEqual(x.avgHist, alone.avgHist);
});

test("the brain's outputs stay between -1 and 1", () => {
  const rng = createRng(1);
  for (let n = 0; n < 50; n++) {
    const g = Array.from({ length: GENOME }, () => rng.gauss() * 5);
    const { out, hidden } = think(g, [1, -1, 0.5, 1.5]);
    assert.equal(out.length, 2);
    for (const v of [...out, ...hidden]) assert.ok(v >= -1 && v <= 1);
  }
  assert.deepEqual(think(new Array(GENOME).fill(0), [1, 1, 1, 1]).out, [0, 0]);
});

test("odd rules don't crash", () => {
  for (const rules of [
    { ...ONE, parents: 500 }, // more parents than creatures
    { ...ONE, elite: 50, pop: 10 }, // more elite than creatures
    { ...ONE, pop: 10, food: 5, genTicks: 300, mutation: 0 },
  ]) {
    const w = createWorld(1, rules);
    runGenerations(w, 3);
    assert.equal(w.creatures.length, rules.pop);
    assert.equal(w.avgHist.length, 3);
  }
});

test("wrap-around takes the short way", () => {
  assert.equal(wrapDelta(700, 800), -100);
  assert.equal(wrapDelta(-700, 800), 100);
  assert.equal(wrapDelta(300, 800), 300);
});

test("colours: founders spread out, elites keep theirs, children drift a little", () => {
  const w = createWorld(3, ONE);
  assert.equal(w.creatures[1].hue, founderHue(1));
  const parentsByFamily = new Map(w.creatures.map((c) => [c.family, c.hue]));
  runGenerations(w, 1);
  for (const c of w.creatures) {
    const parentHue = parentsByFamily.get(c.family)!;
    const diff = Math.abs(((c.hue - parentHue + 540) % 360) - 180);
    if (c.elite) assert.equal(c.hue, parentHue);
    else assert.ok(diff <= 8, `hue drifted ${diff} degrees`);
  }
  for (let id = 0; id < 1000; id++) assert.ok(Math.abs(hueDrift(id)) <= 8);
});

test("records worst, average and best for every generation", () => {
  const w = createWorld(4, ONE);
  runGenerations(w, 5);
  assert.equal(w.worstHist.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(w.worstHist[i] <= w.avgHist[i] && w.avgHist[i] <= w.bestHist[i]);
    assert.ok(w.avgHist[i] <= w.topHalfHist[i] && w.topHalfHist[i] <= w.bestHist[i]);
  }
});

test("families split off once brains drift far enough, and never when turned off", () => {
  const w = createWorld(1, { ...ONE, splitProof: 0 }); // split at once, no trial
  runGenerations(w, 40);
  assert.ok(w.splits > 0, "expected at least one split in 40 generations");
  for (const c of w.creatures) assert.ok(w.families.has(c.family), "every creature's family is known");
  for (const id of w.families.keys()) assert.ok(w.creatures.some((c) => c.family === id), "empty families are forgotten");
  const split = [...w.families.values()].find((f) => f.parent !== null);
  if (split) assert.ok(split.id >= ONE.pop, "new families get new ids");

  const off = createWorld(1, { ...ONE, splitDistance: 0 });
  runGenerations(off, 40);
  assert.equal(off.splits, 0);
  // splitting is bookkeeping only: the same seed evolves identically with or without it
  assert.deepEqual(off.avgHist, w.avgHist);
});

test("brain distance", () => {
  assert.equal(brainDistance([1, 2, 3], [1, 2, 3]), 0);
  assert.equal(brainDistance([0, 0, 0, 0], [1, 1, 1, 1]), 1);
});

test("extinct families move to legacy with their history", () => {
  const w = createWorld(1, ONE);
  runGenerations(w, 40);
  assert.ok(w.legacy.length > 0);
  for (const f of w.legacy) {
    assert.ok(f.diedGeneration !== null && f.diedGeneration >= f.bornGeneration);
    assert.ok(f.peakSize >= 1, "a family that existed had at least one member");
    assert.ok(!w.families.has(f.id), "legacy families are not also alive");
  }
  for (const f of w.families.values()) assert.equal(f.diedGeneration, null);
});

test("legacy keeps only the most recent entries", () => {
  const w = createWorld(1, ONE);
  const template = w.families.get(0)!;
  for (let i = 0; i < LEGACY_LIMIT + 10; i++) retire(w, { ...template, id: 1000 + i }, 1);
  assert.equal(w.legacy.length, LEGACY_LIMIT);
  assert.equal(w.legacy.at(-1)!.id, 1000 + LEGACY_LIMIT + 9);
});

test("elites carry a streak; a long enough streak crowns a champion", () => {
  const w = createWorld(1, { ...ONE, championStreak: 2 });
  let crowned = 0;
  for (let g = 0; g < 60; g++) {
    runGenerations(w, 1);
    for (const c of w.creatures) if (!c.elite) assert.equal(c.streak, 0, "new children start at 0");
    for (const f of [...w.families.values(), ...w.legacy]) crowned = Math.max(crowned, f.champions.length);
  }
  assert.ok(crowned > 0, "expected at least one champion with a streak of 2");
  const fam = [...w.families.values(), ...w.legacy].find((f) => f.champions.length > 0)!;
  assert.notDeepEqual(fam.champions[0].genome, fam.founderRef, "the champion's brain differs from the founder's");

  const off = createWorld(1, { ...ONE, championStreak: 0 });
  runGenerations(off, 60);
  assert.ok([...off.families.values(), ...off.legacy].every((f) => f.champions.length === 0));
});

test("food layouts: one layout is the old behaviour; more layouts add up and report per layout", () => {
  const w = createWorld(2, { ...ONE, layouts: 3, genTicks: 300 });
  const ids = w.creatures.map((c) => c.id);
  for (let i = 0; i < 300; i++) step(w);
  assert.equal(w.layout, 1, "second layout started");
  assert.equal(w.generation, 1, "still the same generation");
  assert.deepEqual(w.creatures.map((c) => c.id), ids, "same creatures on every layout");
  assert.ok(w.creatures.every((c) => c.alive && c.energy === 1), "everyone starts the new layout fresh");
  const eatenSoFar = w.creatures.map((c) => c.eaten);
  for (let i = 0; i < 600; i++) step(w);
  assert.equal(w.generation, 2, "a generation is 3 layouts long");
  assert.equal(w.layout, 0);
  assert.ok(eatenSoFar.some((e) => e > 0), "food was eaten on the first layout");
  assert.ok(w.bestHist[0] >= w.avgHist[0] && w.avgHist[0] >= w.worstHist[0]);

  const odd = createWorld(2, { ...ONE, layouts: 0, genTicks: 300 }); // 0 behaves like 1
  runGenerations(odd, 2);
  assert.equal(odd.avgHist.length, 2);
});

test("food layouts: same seed, same run", () => {
  const rules = { ...ONE, layouts: 2, genTicks: 400 };
  const a = createWorld(8, rules);
  const b = createWorld(8, rules);
  runGenerations(a, 4);
  runGenerations(b, 4);
  assert.deepEqual(a.avgHist, b.avgHist);
});

test("branches: on trial until they out-eat their family; bookkeeping only", () => {
  const w = createWorld(1, ONE);
  let sawBranch = false;
  for (let g = 0; g < 80; g++) {
    runGenerations(w, 1);
    for (const c of w.creatures) {
      if (c.branch === null) continue;
      sawBranch = true;
      const b = w.branches.get(c.branch);
      assert.ok(b, "a creature's branch is on trial");
      assert.equal(b.family, c.family, "branch members stay in the family they may split from");
    }
    for (const id of w.branches.keys()) assert.ok(w.creatures.some((c) => c.branch === id), "empty branches are dropped");
  }
  assert.ok(sawBranch, "expected at least one branch in 80 generations");
  assert.ok(w.splits > 0, "expected at least one branch to prove itself in 80 generations");

  const instant = createWorld(1, { ...ONE, splitProof: 0 });
  runGenerations(instant, 80);
  assert.equal(instant.nextBranchId, 0, "splitProof 0 never puts anyone on trial");
  assert.ok(instant.splits >= w.splits, "a trial can only reduce the number of new families");
  assert.deepEqual(instant.avgHist, w.avgHist, "branches never change who breeds");
});

test("families keep their average food per generation, also in legacy", () => {
  const w = createWorld(1, ONE);
  runGenerations(w, 30);
  for (const f of [...w.families.values(), ...w.legacy]) {
    assert.ok(f.avgHist.length >= 1);
    for (const v of f.avgHist) assert.ok(v >= 0 && v <= f.bestEaten);
  }
  const founder = [...w.families.values()].find((f) => f.parent === null && f.bornGeneration === 1);
  if (founder) assert.ok(founder.avgHist.length <= 30);
});

test("nearest: closest first, ties keep the earlier item, wraps unless there are walls", () => {
  const pts = [{ x: 100, y: 100 }, { x: 790, y: 100 }, { x: 30, y: 100 }, { x: 30, y: 100 }];
  // from (10, 100): wrapping, x=790 is 20 away; with walls it is 780 away
  const wrap = nearest(pts, 10, 100, false, 3);
  assert.deepEqual(wrap.map((n) => n.item), [pts[1], pts[2], pts[3]]);
  assert.equal(wrap[0].dx, -20);
  const walled = nearest(pts, 10, 100, true, 2);
  assert.deepEqual(walled.map((n) => n.item), [pts[2], pts[3]], "tie: earlier first");
  assert.deepEqual(nearest(pts, 10, 100, true, 1, (p) => p.x === 30).map((n) => n.item), [pts[0]], "skip works");
  assert.deepEqual(nearest([], 0, 0, false, 2), []);
});

test("senses: each one adds inputs, and the brain grows to match", () => {
  const none = { senseFood2: 0, senseCreature: 0, walls: 0 };
  const all = { senseFood2: 1, senseCreature: 1, walls: 1 };
  assert.equal(inputCount(none), 4);
  assert.equal(inputCount(all), 11);
  assert.equal(inputLabels(all).length, 11);
  assert.equal(genomeSize(4), GENOME);

  const rules = { ...ONE, ...all, genTicks: 400 };
  const a = createWorld(3, rules);
  const b = createWorld(3, rules);
  assert.equal(a.creatures[0].g.length, genomeSize(11));
  runGenerations(a, 3);
  runGenerations(b, 3);
  assert.deepEqual(a.avgHist, b.avgHist, "same seed, same run with every sense on");
  for (const c of a.creatures) assert.equal(c.g.length, genomeSize(11));
  step(a);
  const live = a.creatures.find((c) => c.alive)!;
  assert.equal(live.inputs.length, 11);
  for (const v of live.inputs) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1.5);
});

test("walls: creatures stay on the map and sense the wall ahead", () => {
  assert.equal(wallAhead(790, 300, 0), 0.05); // facing right, 10 from the wall
  assert.equal(wallAhead(400, 300, Math.PI), 1); // 400 away: reads as far
  assert.ok(Math.abs(wallAhead(100, 590, Math.PI / 2) - 0.05) < 1e-12); // facing down, 10 from the bottom
  const w = createWorld(4, { ...ONE, walls: 1, genTicks: 600 });
  for (let i = 0; i < 600; i++) {
    step(w);
    for (const c of w.creatures) assert.ok(c.x >= 0 && c.x <= 800 && c.y >= 0 && c.y <= 600);
  }
});

test("newcomers: a hard-mutated new family each generation, kept alive while protected", () => {
  const rules = { ...ONE, newcomers: 1, protectGens: 3, genTicks: 400 };
  const w = createWorld(6, rules);
  runGenerations(w, 1);
  const fresh = [...w.families.values()].filter((f) => f.newcomer);
  assert.equal(fresh.length, 1);
  const fam = fresh[0];
  assert.equal(w.newcomerCount, 1);
  assert.equal(fam.bornGeneration, 2);
  assert.equal(fam.protectedUntil, 5);
  assert.ok(fam.parent !== null, "remembers which family it came from");
  assert.equal(w.creatures.filter((c) => c.family === fam.id).length, 1);
  assert.ok(brainDistance(fam.ref, fam.founderRef) === 0);
  for (let g = 2; g < 5; g++) {
    runGenerations(w, 1);
    assert.ok(w.creatures.some((c) => c.family === fam.id), `protected in generation ${w.generation}`);
  }
  assert.equal(w.creatures.length, rules.pop, "population size never changes");

  const a = createWorld(6, rules);
  const b = createWorld(6, rules);
  runGenerations(a, 6);
  runGenerations(b, 6);
  assert.deepEqual(a.avgHist, b.avgHist, "same seed, same run with newcomers");
  assert.equal(createWorld(6, ONE).newcomerCount, 0);
});

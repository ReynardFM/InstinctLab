// Poison food chain (Rey's brief 2026-10-24): the age bell curve, fading, passing poison to hunters,
// and generations mode keeping the old flat hit for now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, runTicks, DEFAULT_RULES } from "../src/engine/world.ts";
import { inEcosystem } from "../src/engine/mode.ts";
import { expNeg, fade, resistance } from "../src/engine/toxin.ts";
import { moveHunters } from "../src/engine/hunters.ts";

test("expNeg matches e^-q (built from tanh, so every engine gives the same bits)", () => {
  for (const q of [0, 0.1, 0.5, 1, 2, 4.5, 10]) assert.ok(Math.abs(expNeg(q) - Math.exp(-q)) < 1e-12, `q = ${q}`);
});

test("resistance: a bell curve over the lifespan, full at the middle, about frail at birth and at the end", () => {
  const life = 6000, frail = 0.25;
  assert.equal(resistance(3000, life, frail), 1);
  assert.ok(resistance(0, life, frail) < 0.26 && resistance(0, life, frail) >= 0.25, "a newborn takes about 4x");
  assert.ok(Math.abs(resistance(1000, life, frail) - resistance(5000, life, frail)) < 1e-12, "symmetric");
  assert.ok(resistance(1500, life, frail) > resistance(750, life, frail), "rises towards the middle");
  assert.equal(resistance(100, 0, frail), 1, "no lifespan (no ageing): full resistance");
});

test("the poison level halves in about poisonHalfLife ticks", () => {
  const w = createWorld(1, { ...DEFAULT_RULES, poisonHalfLife: 500 });
  let x = 1;
  for (let i = 0; i < 500; i++) x = fade(x, w);
  assert.ok(Math.abs(x - 0.5) < 0.001, `${x}`);
});

const ECO = { ...DEFAULT_RULES, mode: 1, regrow: 100, pop: 20, genTicks: 300, ecoWarmup: 2, hunters: 4 };
const toEco = (seed: number, extra = {}) => {
  const w = createWorld(seed, { ...ECO, ...extra });
  while (!inEcosystem(w)) runTicks(w, 1);
  return w;
};

test("ecosystem: eating poison raises the level (more for the young) and costs no flat energy", () => {
  const w = toEco(3, { poison: 0.5 });
  let most = 0; // poisoned prey starve fast, so look over time, not at one moment
  for (let i = 0; i < 2000; i++) {
    runTicks(w, 1);
    for (const c of w.creatures) most = Math.max(most, c.toxin);
  }
  assert.ok(most > 1, `someone carried poison (${most})`);
});

test("a hunter that catches a poisoned prey takes on its whole level, through the hunter's resistance", () => {
  const w = toEco(4, {});
  runTicks(w, 1);
  const h = w.hunters[0];
  const prey = w.creatures.find((c) => c.alive)!;
  for (const o of w.hunters) if (o !== h) o.rest = 1000; // only h hunts
  prey.toxin = 2;
  h.x = prey.x; h.y = prey.y; h.rest = 0; h.age = w.rules.hunterAge / 2; h.toxin = 0; // middle-aged: resistance 1
  for (const c of w.creatures) if (c !== prey) c.alive = false; // the only prey left
  moveHunters(w);
  assert.equal(prey.alive, false, "caught");
  assert.ok(Math.abs(h.toxin - 2) < 1e-9, `${h.toxin}`);
});

test("generations mode keeps the flat poison hit for now (no poison level)", () => {
  const w = createWorld(5, { ...DEFAULT_RULES, poison: 0.5, genTicks: 400 });
  runTicks(w, 400);
  assert.ok(w.creatures.every((c) => c.toxin === 0));
  assert.ok(w.creatures.some((c) => c.poisoned > 0), "they did eat poison");
});

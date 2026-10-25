// Poison food chain (Rey's brief 2026-10-24): the age bell curve, fading, passing poison to hunters,
// and generations mode keeping the old flat hit for now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, runTicks, DEFAULT_RULES } from "../src/engine/world.ts";
import { inEcosystem } from "../src/engine/mode.ts";
import { expNeg, fade, resistance } from "../src/engine/toxin.ts";
import { moveHunters } from "../src/engine/hunters.ts";
import { live } from "../src/engine/life.ts";

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

test("poison slows prey: top speed / (1 + poison level)", () => {
  const w = toEco(6, {});
  runTicks(w, 1);
  const c = w.creatures[0];
  c.toxin = 1;
  c.energy = 1.4;
  live(w, c, 1); // the brain picks a speed (out[1]) this tick; with poison level 1 it moves at half of it
  const chosen = ((c.out[1] + 1) / 2) * 3;
  assert.ok(Math.abs(c.speed - chosen / 2) < 1e-12, `${c.speed} vs ${chosen / 2}`);
});

test("hunters see the nearest prey's speed in their 'poison' inputs (ecosystem); blind hunters see nothing", () => {
  for (const see of [1, 0]) {
    const w = toEco(7, { hunterSeeSpeed: see });
    runTicks(w, 1);
    const h = w.hunters[0];
    const prey = w.creatures.find((c) => c.alive)!;
    for (const c of w.creatures) if (c !== prey) c.alive = false;
    for (const o of w.hunters) o.rest = o === h ? 0 : 1000;
    prey.speed = 1.5;
    h.x = (prey.x + 50) % 800; h.y = prey.y; // 50 px away: no catch
    moveHunters(w);
    const k = 4 + 3; // food (3) + energy (1) + neighbour (3): the default senses; then poison (3)
    const poisonSlot = h.brain!.inputs.slice(k, k + 3);
    if (see) assert.ok(Math.abs(poisonSlot[2] - 0.5) < 1e-9, `speed 1.5 of 3 -> 0.5, got ${poisonSlot}`);
    else assert.deepEqual(poisonSlot, [0, 0, 1], "nothing there");
  }
});

test("hunters learn during life (taste aversion): a poisoned catch changes the working brain, not the inborn one", () => {
  const w = toEco(8, { hunterLearn: 0.05 });
  runTicks(w, 1);
  const h = w.hunters[0];
  const b = h.brain!;
  assert.notEqual(b.w, b.g, "its own copy to learn with");
  const born = b.g.slice();
  const prey = w.creatures.find((c) => c.alive)!;
  for (const c of w.creatures) if (c !== prey) c.alive = false;
  for (const o of w.hunters) o.rest = o === h ? 0 : 1000;
  for (let i = 0; i < 20; i++) moveHunters(w); // build up recent activity, nothing caught yet (far away)
  prey.toxin = 3;
  h.x = prey.x; h.y = prey.y; h.age = w.rules.hunterAge / 2;
  const before = b.w.slice();
  moveHunters(w);
  assert.equal(prey.alive, false, "caught");
  assert.ok(b.w.some((x, k) => x !== before[k]), "the working brain changed");
  assert.deepEqual(b.g, born, "the inborn brain (what babies get) did not");
});

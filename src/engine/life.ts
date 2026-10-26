// One tick of one creature's life: sense, think, move, pay for it, eat, maybe starve.
// Shared by both modes (generations and ecosystem).
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature } from "./creature.ts";
import { newFood } from "./creature.ts";
import { learn, thinkInto } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { senseInto } from "./senses.ts";
import { H, W } from "./space.ts";
import { spreading } from "./plants.ts";
import { dose, fade, fadeResist, harm, newPoison, preyLife, train } from "./toxin.ts";

// Energy a creature loses by eating poison (good food gives +0.3).
export const POISON_HIT = 0.5;

// Learning: how fast a connection's memory of recent activity fades per tick (0.9 = about 10 ticks).
export const LEARN_DECAY = 0.9;
// relativeReward: how fast the 'usual intake' follows recent rewards (0.002 = averages about the last 500 ticks).
export const USUAL_RATE = 0.002;

// costFactor multiplies the energy cost (ageing in ecosystem mode; 1 otherwise).
export function live(w: World, c: Creature, costFactor: number): void {
  const walls = w.rules.walls > 0;
  const seen = senseInto(w, c); // fills c.inputs
  thinkInto(c.w, c.inputs, c.hidden, c.out); // fills c.hidden, c.out
  const hidden = c.hidden;
  const out = c.out;

  // poison slows you down (Rey 2026-10-25): top speed / (1 + poison level), so a sick prey moves like an old one
  const speed = (((out[1] + 1) / 2) * 3) / (newPoison(w) ? 1 + harm(c.toxin, c.resist) : 1);
  c.speed = speed;
  c.a += out[0] * 0.2;
  if (walls) {
    // walls stop you: slide along them instead of passing through
    c.x = Math.min(Math.max(c.x + cos(c.a) * speed, 0), W);
    c.y = Math.min(Math.max(c.y + sin(c.a) * speed, 0), H);
  } else {
    c.x = (c.x + cos(c.a) * speed + W) % W;
    c.y = (c.y + sin(c.a) * speed + H) % H;
  }
  if (w.grids?.creaturesOn) w.grids.creatures.move(c.slot!, c.x, c.y); // later creatures this tick sense where it is now
  const sick = newPoison(w) ? 1 + harm(c.toxin, c.resist) : 1; // poison level: everything costs more (toxin.ts), less with resistance
  c.energy -= (0.0005 + speed * 0.0004) * w.rules.energyCost * costFactor * sick; // moving costs energy; standing still costs a little
  if (c.toxin > 0) c.toxin = fade(c.toxin, w);
  if (c.resist > 0) {
    c.energy -= w.rules.resistUpkeep * c.resist; // resistance has upkeep
    c.resist = fadeResist(c.resist, w);
  }
  const near = w.measure && newPoison(w) ? countNearHunter(w, c) : false;
  let reward = 0;
  if (seen.food && seen.foodDist < 6) {
    reward = seen.food.poison ? -1 : 1;
    if (seen.food.poison) {
      c.poisoned++;
      if (newPoison(w)) {
        c.toxin += dose(w.rules.poisonDose, c.age, preyLife(w), w);
        c.resist = train(c.resist, w.rules.resistTrain);
        w.eco.sick.poisonEaten++;
        if (w.measure) countPoisonEaten(w, c, near);
      }
      else c.energy -= POISON_HIT;
    } else {
      c.eaten++;
      c.energy = Math.min(c.energy + 0.3, 1.5);
    }
    if (spreading(w)) {
      seen.food.readyAt = w.tick + Math.max(1, w.rules.regrow); // spreading food (plants.ts): an eaten plant regrows where it was
    } else {
      Object.assign(seen.food, newFood(w, seen.food.poison)); // same kind, somewhere new
      if (w.grids?.foodOn) w.grids.food.move(seen.food.slot!, seen.food.x, seen.food.y);
      if (w.rules.regrow > 0) seen.food.readyAt = w.tick + w.rules.regrow;
    }
  }
  const r = w.rules;
  if (r.thinkCost > 0) {
    let busy = 0;
    for (const v of hidden) busy += v < 0 ? -v : v;
    c.energy -= (r.thinkCost * busy) / hidden.length; // a brain firing at full strength costs thinkCost per tick
  }
  if (r.learnRate > 0) {
    let felt = reward;
    if (r.relativeReward > 0) {
      felt = reward - c.usual; // better or worse than usual; zero on average, so no steady drift
      c.usual += USUAL_RATE * (reward - c.usual);
    }
    const rate = r.energyGate > 0 ? r.learnRate * Math.max(0, Math.min(c.energy / 1.5, 1)) : r.learnRate;
    const rates = r.plasticity > 0 ? c.g : null; // evolved per-connection rates sit after the weights
    const change = learn(c.w, c.trace, c.inputs, hidden, out, felt, rate, LEARN_DECAY, rates, c.w.length);
    c.learned += change;
    c.energy -= r.learnCost * change;
    if (r.forget > 0) for (let k = 0; k < c.w.length; k++) c.w[k] += r.forget * (c.g[k] - c.w[k]); // fade back toward the inborn brain
  }
  if (c.energy <= 0) {
    c.alive = false;
    c.diedAt = w.tick;
  }
}


// ---------- eco-lab measures (World.measure; counting only) ----------
export const MEASURE_NEAR = 80; // "a hunter is near": within this many px
export const MEASURE_WINDOW = 20000; // ticks per window, to see a trend over a run

function measureWindow(w: World) {
  const m = w.eco.m;
  const wi = Math.floor(w.tick / MEASURE_WINDOW);
  while (m.win.length <= wi) m.win.push({ nearEat: 0, farEat: 0, nearTicks: 0, farTicks: 0 });
  return m.win[wi];
}

function measureFamily(w: World, c: Creature) {
  let f = w.eco.m.fam.get(c.family);
  if (!f) {
    f = { eat: 0, ticks: 0, nearEat: 0, nearTicks: 0 };
    w.eco.m.fam.set(c.family, f);
  }
  return f;
}

// Is a hunter within MEASURE_NEAR of this prey? Counts the prey-tick as near or far.
function countNearHunter(w: World, c: Creature): boolean {
  const walls = w.rules.walls > 0;
  let near = false;
  for (const h of w.hunters) {
    let dx = h.x - c.x;
    let dy = h.y - c.y;
    if (!walls) {
      if (dx > W / 2) dx -= W;
      else if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H;
      else if (dy < -H / 2) dy += H;
    }
    if (dx * dx + dy * dy < MEASURE_NEAR * MEASURE_NEAR) {
      near = true;
      break;
    }
  }
  const win = measureWindow(w);
  const f = measureFamily(w, c);
  f.ticks++;
  if (near) {
    win.nearTicks++;
    f.nearTicks++;
  } else win.farTicks++;
  return near;
}

function countPoisonEaten(w: World, c: Creature, near: boolean): void {
  const win = measureWindow(w);
  const f = measureFamily(w, c);
  f.eat++;
  if (near) {
    win.nearEat++;
    f.nearEat++;
  } else win.farEat++;
}

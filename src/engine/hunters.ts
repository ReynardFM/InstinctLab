// Hunters (predators). Two kinds, set by rules.hunterBrains:
//   0 = chasers: no brain, step straight towards the nearest prey (the cheapest test from the predators brief).
//   1 = brains (P2): each hunter has a brain shaped like a prey brain and evolves, scored by prey caught.
//       Its senses are the prey's senses re-pointed: "food" = the nearest prey, "2nd food" = the second-nearest
//       prey, "neighbour" = the nearest other hunter, "energy" = ready to catch (1) or resting (0); the poison
//       and hunter inputs read "nothing there". The same shape is what lets a dead prey family's brain be
//       reused as a hunter: its "go to food" wiring becomes "go to prey".
// A caught prey is out for the rest of that food map (it eats nothing more, so it scores less).
// Hunters arrive at generation rules.hunterFrom: with brains, half of the first hunters get the main brains
// of the most recently extinct prey families ("borrowed"), half random brains ("random"). Every hunter keeps
// the tag of the brain its line started from, so the lab can see which start wins.
// Hunters have their own random numbers (World.hrng): turning them on doesn't change the prey's draws.
// Gene pool (rules.hunterPool): more brains are kept than hunt at once; each food map takes the next
// rules.hunters of them in turn, and a brain is scored by catches per map it played. With 4 brains for 4
// hunters the pool stopped improving after about 10 generations; 12 kept improving (README, 2026-10-22).
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature } from "./creature.ts";
import { genomeSize, thinkInto, type Genome } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { inputCount, wallAhead, writeNothing, writeTowards } from "./senses.ts";
import { H, W, offset } from "./space.ts";
import { inEcosystem } from "./mode.ts";

export interface Hunter {
  x: number;
  y: number;
  rest: number; // ticks left digesting after a catch (doesn't move or catch)
  brain: HunterBrain | null; // null for chasers
  energy: number; // ecosystem mode: drains each tick, a catch refills it; at 0 the hunter dies (1 elsewhere, unused)
  age: number; // ecosystem mode: ticks lived
}

export type Origin = "borrowed" | "random";

// A hunter's brain and its record. Kept across food maps and generations (World.hunterBrains).
export interface HunterBrain {
  id: number;
  g: Genome; // weights only (a borrowed brain's evolved learning rates, if any, are left behind)
  origin: Origin; // what its line started from
  from: number | null; // borrowed: the prey family whose main brain it started as
  caught: number; // prey caught this generation, all food maps it played
  maps: number; // food maps it played this generation
  a: number; // heading on the current map
  // last senses and thoughts (like a creature's), for the page
  inputs: number[];
  hidden: number[];
  out: number[];
}

export interface HunterStats {
  avg: number; // prey caught per hunter per food map
  best: number; // the best hunter, per food map
  borrowed: number; // share of hunters whose line started from a borrowed brain
  avgBorrowed: number | null; // average catch per map of borrowed-line hunters (null: none)
  avgRandom: number | null;
}

export const CATCH = 6; // a hunter this close to a prey catches it (same reach as eating)
export const REST = 30; // ticks a hunter rests after a catch
export const TURN = 0.2; // most a brain hunter turns per tick (radians), the same as prey

// Generations mode only: in ecosystem mode the hunters come in when the ecosystem starts (startEcoHunters),
// not during its warm-up generations.
export const huntersArrived = (w: World) => w.rules.hunters > 0 && w.rules.mode !== 1 && w.generation >= w.rules.hunterFrom;

// Hunters' starting spots for a new food map, drawn after the food so the food is the same as without hunters.
// Chasers draw exactly what they always did (x, y), so old runs replay unchanged.
export function placeHunters(w: World): void {
  w.hunters = [];
  if (!huntersArrived(w)) return;
  if (w.rules.hunterBrains > 0) {
    if (w.hunterBrains.length === 0) w.hunterBrains = firstHunterBrains(w);
    const pool = w.hunterBrains.length;
    const onMap = Math.min(w.rules.hunters, pool);
    // in turn: map 0 takes brains 0..3, map 1 brains 4..7 and so on; when a generation's maps don't reach
    // every brain, the next generation carries on where this one stopped
    const start = (w.generation * Math.max(1, w.rules.layouts) + w.layout) * onMap;
    for (let i = 0; i < onMap; i++) {
      const b = w.hunterBrains[(start + i) % pool];
      b.maps++;
      b.a = w.env.next() * Math.PI * 2;
      w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, brain: b, energy: 1, age: 0 });
    }
    return;
  }
  for (let i = 0; i < w.rules.hunters; i++) w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, brain: null, energy: 1, age: 0 });
}

const hunterGenomeLength = (w: World) => genomeSize(inputCount(w.rules), w.rules.hidden);

function newHunterBrain(w: World, g: Genome, origin: Origin, from: number | null): HunterBrain {
  return {
    id: w.nextHunterId++, g, origin, from, caught: 0, maps: 0, a: 0,
    inputs: new Array(inputCount(w.rules)).fill(0), hidden: new Array(w.rules.hidden).fill(0), out: [0, 0],
  };
}

// The first hunters: borrowed and random alternate (borrowed first), the borrowed ones from the most
// recently extinct families, newest first. With fewer extinct families than borrowed seats, the rest are
// random (and tagged random: the tag says what the brain is, not what the seat was meant for).
export const poolSize = (w: World) => Math.max(w.rules.hunters, w.rules.hunterPool);

export function firstHunterBrains(w: World, n = poolSize(w)): HunterBrain[] {
  const len = hunterGenomeLength(w);
  const dead = w.legacy.filter((f) => f.ref.length >= len).reverse(); // newest first
  const out: HunterBrain[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0 && used < dead.length) {
      const fam = dead[used++];
      out.push(newHunterBrain(w, fam.ref.slice(0, len), "borrowed", fam.id));
    } else {
      out.push(newHunterBrain(w, Array.from({ length: len }, () => w.hrng.gauss() * 0.5), "random", null));
    }
  }
  return out;
}

// One tick for every hunter, after the prey have moved. In ecosystem mode hunters always have brains.
export function moveHunters(w: World): void {
  if (w.rules.hunterBrains > 0 || inEcosystem(w)) moveBrainHunters(w);
  else moveChasers(w);
}

// Chasers: step towards the nearest living prey; catch it when close.
function moveChasers(w: World): void {
  const walls = w.rules.walls > 0;
  const speed = w.rules.hunterSpeed;
  for (const h of w.hunters) {
    if (h.rest > 0) {
      h.rest--;
      continue;
    }
    let prey: Creature | null = null;
    let bdx = 0;
    let bdy = 0;
    let bd2 = Infinity;
    for (const c of w.creatures) {
      if (!c.alive) continue;
      const dx = offset(c.x - h.x, W, walls);
      const dy = offset(c.y - h.y, H, walls);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) {
        bd2 = d2;
        bdx = dx;
        bdy = dy;
        prey = c;
      }
    }
    if (!prey) continue;
    const d = Math.sqrt(bd2);
    const step = Math.min(speed, d);
    if (d > 0) {
      const nx = h.x + (bdx / d) * step;
      const ny = h.y + (bdy / d) * step;
      h.x = walls ? Math.min(Math.max(nx, 0), W) : (nx + W) % W;
      h.y = walls ? Math.min(Math.max(ny, 0), H) : (ny + H) % H;
    }
    if (d - step < CATCH) catchPrey(w, h, prey);
  }
}

function catchPrey(w: World, h: Hunter, prey: Creature): void {
  prey.alive = false;
  prey.diedAt = w.tick;
  prey.caught++;
  h.rest = REST;
  if (h.brain) h.brain.caught++;
  if (inEcosystem(w)) {
    h.energy = Math.min(h.energy + w.rules.hunterMeal, MAX_ENERGY);
    w.eco.caught++;
  }
}

// The two nearest living prey from (x, y): index into w.creatures (-1 = none) and offsets. Ties keep the earlier creature.
const near = { i1: -1, dx1: 0, dy1: 0, d21: Infinity, i2: -1, dx2: 0, dy2: 0, d22: Infinity };
function nearestPrey(w: World, x: number, y: number, walls: boolean): void {
  near.i1 = near.i2 = -1;
  near.d21 = near.d22 = Infinity;
  const cs = w.creatures;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c.alive) continue;
    const dx = offset(c.x - x, W, walls);
    const dy = offset(c.y - y, H, walls);
    const d2 = dx * dx + dy * dy;
    if (d2 < near.d21) {
      near.i2 = near.i1;
      near.dx2 = near.dx1;
      near.dy2 = near.dy1;
      near.d22 = near.d21;
      near.i1 = i;
      near.dx1 = dx;
      near.dy1 = dy;
      near.d21 = d2;
    } else if (d2 < near.d22) {
      near.i2 = i;
      near.dx2 = dx;
      near.dy2 = dy;
      near.d22 = d2;
    }
  }
}

// Brain hunters: sense, think, turn and move like a creature (top speed rules.hunterSpeed), then catch the
// nearest prey if it is within reach. Resting hunters don't think or move.
function moveBrainHunters(w: World): void {
  const r = w.rules;
  const walls = r.walls > 0;
  const hs = w.hunters;
  const eco = inEcosystem(w);
  for (let n = 0; n < hs.length; n++) {
    const h = hs[n];
    const b = h.brain!;
    if (h.rest > 0) {
      h.rest--;
      continue;
    }
    nearestPrey(w, h.x, h.y, walls);
    if (near.i1 < 0) continue; // nobody left to hunt
    const inputs = b.inputs;
    const cosH = cos(b.a);
    const sinH = sin(b.a);
    let k = writeTowards(inputs, 0, near.dx1, near.dy1, near.d21, cosH, sinH); // "food" = nearest prey
    inputs[k++] = eco ? h.energy : 1; // "energy": its real energy in ecosystem mode; elsewhere 1 = ready (resting hunters don't think)
    if (r.senseFood2) k = near.i2 >= 0 ? writeTowards(inputs, k, near.dx2, near.dy2, near.d22, cosH, sinH) : writeNothing(inputs, k);
    if (r.senseCreature) {
      let bdx = 0;
      let bdy = 0;
      let bd2 = Infinity;
      for (let m = 0; m < hs.length; m++) {
        if (m === n) continue;
        const dx = offset(hs[m].x - h.x, W, walls);
        const dy = offset(hs[m].y - h.y, H, walls);
        const d2 = dx * dx + dy * dy;
        if (d2 < bd2) {
          bd2 = d2;
          bdx = dx;
          bdy = dy;
        }
      }
      k = bd2 < Infinity ? writeTowards(inputs, k, bdx, bdy, bd2, cosH, sinH) : writeNothing(inputs, k);
    }
    if (r.poison > 0) k = writeNothing(inputs, k);
    if (r.hunterSense > 0) k = writeNothing(inputs, k); // prey have hunter inputs; for a hunter they read nothing
    if (walls) inputs[k++] = wallAhead(h.x, h.y, b.a);
    if (inputs.length !== k) inputs.length = k;
    thinkInto(b.g, inputs, b.hidden, b.out);
    b.a += b.out[0] * TURN;
    const speed = ((b.out[1] + 1) / 2) * r.hunterSpeed;
    if (walls) {
      h.x = Math.min(Math.max(h.x + cos(b.a) * speed, 0), W);
      h.y = Math.min(Math.max(h.y + sin(b.a) * speed, 0), H);
    } else {
      h.x = (h.x + cos(b.a) * speed + W) % W;
      h.y = (h.y + sin(b.a) * speed + H) % H;
    }
    nearestPrey(w, h.x, h.y, walls);
    if (near.i1 >= 0 && near.d21 < CATCH * CATCH) catchPrey(w, h, w.creatures[near.i1]);
  }
}

// After a generation (brain hunters that have arrived): record how they did, then breed the next hunters.
// Score = catches per map played (a brain that played no map this generation ranks last). The best is
// copied unchanged; the others are children of the better half, nudged by rules.mutation. A child keeps
// its parent's origin tag. The pool keeps its size (poolSize).
export function breedHunters(w: World): void {
  const bs = w.hunterBrains;
  if (bs.length === 0) return;
  const rate = (b: HunterBrain) => (b.maps > 0 ? b.caught / b.maps : -1);
  const ranked = [...bs].sort((a, b) => rate(b) - rate(a)); // stable: ties keep the earlier hunter
  const perMap = (xs: HunterBrain[]) => {
    const maps = xs.reduce((s, b) => s + b.maps, 0);
    return maps > 0 ? xs.reduce((s, b) => s + b.caught, 0) / maps : null;
  };
  const avgOf = (o: Origin) => perMap(bs.filter((b) => b.origin === o));
  w.hunterHist.push({
    avg: perMap(bs) ?? 0,
    best: Math.max(0, rate(ranked[0])),
    borrowed: bs.filter((b) => b.origin === "borrowed").length / bs.length,
    avgBorrowed: avgOf("borrowed"),
    avgRandom: avgOf("random"),
  });
  const n = poolSize(w);
  const parents = Math.max(1, Math.ceil(ranked.length / 2));
  const next: HunterBrain[] = [newHunterBrain(w, ranked[0].g, ranked[0].origin, ranked[0].from)];
  while (next.length < n) {
    const p = ranked[Math.floor(w.hrng.next() * parents)];
    next.push(newHunterBrain(w, p.g.map((x) => x + w.hrng.gauss() * w.rules.mutation), p.origin, p.from));
  }
  w.hunterBrains = next;
}

// ---------- ecosystem mode (Rey's brief 2026-10-23) ----------
// Hunters live like prey: energy drains every tick (rules.hunterHunger), a catch refills it
// (rules.hunterMeal), a hunter with rules.hunterBirth energy splits off a baby with half its energy and a
// mutated copy of its brain, and a hunter dies when its energy runs out or at rules.hunterAge. When one
// side dies out, the round ends and that side restarts from its best brains so far (hunters: most prey
// caught in a lifetime; prey: longest life); the other side carries on as it is.

export const MAX_ENERGY = 1.5; // the most a hunter can hold (the same as prey)
export const HUNTER_CAP = 60; // safety limit for speed, not a game rule: hunter births pause at it
export const BEST_KEEP = 8; // best brains remembered per side for a restart

export interface BestBrain {
  g: Genome;
  score: number; // hunters: prey caught in its life; prey: ticks lived
  origin: Origin;
  from: number | null;
}

// Keeps the BEST_KEEP highest scores, highest first. A tie doesn't push out an earlier brain.
export function remember(list: BestBrain[], b: BestBrain): void {
  if (list.length === BEST_KEEP && b.score <= list[list.length - 1].score) return;
  let i = list.length;
  while (i > 0 && b.score > list[i - 1].score) i--;
  list.splice(i, 0, b);
  if (list.length > BEST_KEEP) list.pop();
}

function newEcoHunter(w: World, brain: HunterBrain, x: number, y: number, energy: number): Hunter {
  brain.a = w.hrng.next() * Math.PI * 2;
  return { x, y, rest: 0, brain, energy, age: 0 };
}

// The ecosystem's first hunters (rules.hunters of them): borrowed and random, as in generations mode.
export function startEcoHunters(w: World): void {
  w.hunters = firstHunterBrains(w, w.rules.hunters).map((b) => newEcoHunter(w, b, w.hrng.next() * W, w.hrng.next() * H, 1));
  w.eco.huntersStarted = true;
}

// After everyone has moved and hunted: hunger, age, babies, deaths. Uses the hunters' own random numbers.
export function liveEcoHunters(w: World): void {
  const r = w.rules;
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  const born: Hunter[] = [];
  for (const h of w.hunters) {
    h.energy -= r.hunterHunger;
    h.age++;
    if (h.energy >= r.hunterBirth && w.hunters.length + born.length < HUNTER_CAP) {
      const half = h.energy / 2;
      h.energy -= half;
      const p = h.brain!;
      const child = newHunterBrain(w, p.g.map((x) => x + w.hrng.gauss() * r.mutation), p.origin, p.from);
      born.push(newEcoHunter(w, child, place(h.x + (w.hrng.next() - 0.5) * 10, W), place(h.y + (w.hrng.next() - 0.5) * 10, H), half));
      w.eco.hunterBirths++;
    }
  }
  const alive: Hunter[] = [];
  for (const h of w.hunters) {
    const old = h.age >= r.hunterAge;
    if (h.energy > 0 && !old) {
      alive.push(h);
      continue;
    }
    w.eco.hunterDeaths++;
    if (old) w.eco.hunterOldAge++;
    const b = h.brain!;
    remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from });
  }
  w.hunters = alive.concat(born);
}

// All hunters dead: rules.hunters new ones from the best hunter brains so far (the best as it is, the
// rest mutated copies, round-robin). Random brains if none were recorded.
export function restartHunters(w: World): void {
  const best = w.eco.bestHunters;
  w.hunters = [];
  for (let i = 0; i < w.rules.hunters; i++) {
    const src = best.length ? best[i % best.length] : null;
    const brain = src
      ? newHunterBrain(w, i < best.length ? src.g.slice() : src.g.map((x) => x + w.hrng.gauss() * w.rules.mutation), src.origin, src.from)
      : newHunterBrain(w, Array.from({ length: hunterGenomeLength(w) }, () => w.hrng.gauss() * 0.5), "random", null);
    w.hunters.push(newEcoHunter(w, brain, w.hrng.next() * W, w.hrng.next() * H, 1));
  }
}

// After a prey wipe (Rey's call 2026-10-23): the surviving hunters are cut back to rules.hunters, so the
// new prey get a chance: the best catcher, the ones closest to the average catch (at or below it first),
// and one new random brain. With 4: 1 best, 2 average, 1 random. Scores are prey caught in a lifetime;
// ties keep the earlier hunter. The hunters cut are remembered like any that died.
export function thinHunters(w: World): void {
  const n = w.rules.hunters;
  const hs = w.hunters;
  if (hs.length <= n) return;
  const score = (h: Hunter) => h.brain!.caught;
  let best = hs[0];
  for (const h of hs) if (score(h) > score(best)) best = h;
  const mean = hs.reduce((s, h) => s + score(h), 0) / hs.length;
  const key = (h: Hunter) => (score(h) <= mean ? mean - score(h) : 1e9 + score(h) - mean); // at or below the average first
  const average = hs.filter((h) => h !== best).sort((a, b) => key(a) - key(b)).slice(0, Math.max(0, n - 2));
  const keep = n >= 1 ? [best, ...average] : [];
  for (const h of hs) {
    if (keep.includes(h)) continue;
    const b = h.brain!;
    remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from });
  }
  if (n >= 2) {
    const g = Array.from({ length: hunterGenomeLength(w) }, () => w.hrng.gauss() * 0.5);
    keep.push(newEcoHunter(w, newHunterBrain(w, g, "random", null), w.hrng.next() * W, w.hrng.next() * H, 1));
  }
  w.hunters = keep;
}

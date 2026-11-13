// Hunters (predators). Two kinds, set by rules.hunterBrains:
//   0 = chasers: no brain, step straight towards the nearest prey (the cheapest test from the predators brief).
//   1 = brains (P2): each hunter has a brain shaped like a prey brain and evolves, scored by prey caught.
//       Its senses are the prey's senses re-pointed: "food" = the nearest prey, "2nd food" = the second-nearest
//       prey, "neighbour" = the nearest other hunter, "energy" = ready to catch (1) or resting (0); the poison
//       and hunter inputs read "nothing there". The same shape is what lets a dead prey family's brain be
//       reused as a hunter: its "go to food" wiring becomes "go to prey". With the eye on (rules.eye), prey
//       brains have another shape: hunters keep this old layout and every hunter brain starts random.
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
import { genomeSize, learn, thinkInto, type Genome } from "./brain.ts";
import { digestTick, fullness, gutToxin, hasRoom, hunterDigest, swallow, type Gut } from "./gut.ts";
import { LEARN_DECAY, USUAL_RATE } from "./life.ts";
import { cos, sin, tanh } from "./dmath.ts";
import { EYE_R2, eyeSlice, eyeSlices, hunterEyeSlices, hunterInputCount, wallAhead, writeNothing, writeTowards } from "./senses.ts";
import { H, W, offset } from "./space.ts";
import { inEcosystem } from "./mode.ts";
import { PREY_LIFE_RATE, SICK, babyResist, dose, fadeHunter, harm } from "./toxin.ts";
// The lifespan a hunter's age resistance is measured against: the fixed hunterAge, or (rules.hunterRealLife) how old hunters really die
const hunterLifeFor = (w: World): number => (w.rules.hunterRealLife > 0 ? w.eco.hunterLife : w.rules.hunterAge);

export interface Hunter {
  x: number;
  y: number;
  rest: number; // ticks left digesting after a catch (doesn't move or catch)
  speed: number; // how far it moved last tick (prey with rules.eyeMotion see it)
  brain: HunterBrain | null; // null for chasers
  energy: number; // ecosystem mode: drains each tick, a catch refills it; at 0 the hunter dies (1 elsewhere, unused)
  age: number; // ecosystem mode: ticks lived
  toxin: number; // ecosystem mode: poison level taken on from poisoned prey (toxin.ts)
  resist: number; // ecosystem mode: poison resistance 0..1, trained by poisoned catches (toxin.ts)
  gut?: Gut; // rules.digest: its stomach (gut.ts), made on the first catch
  high?: number; // rules.hunterHangover: ticks it has been poisoned (level above SICK) since its last hangover started
  hang?: number; // rules.hunterHangover: ticks of hangover left (the debuff runs while this is above 0)
}

export type Origin = "borrowed" | "random";

// A hunter's brain and its record. Kept across food maps and generations (World.hunterBrains).
export interface HunterBrain {
  id: number;
  g: Genome; // weights only (a borrowed brain's evolved learning rates, if any, are left behind)
  w: Genome; // the brain it uses now: g, or its own copy that learns during life (rules.hunterLearn, ecosystem)
  trace: number[]; // learning: recent activity of each connection (empty when not learning)
  usual: number; // rules.relativeReward: running average reward per tick (its "usual")
  origin: Origin; // what its line started from
  from: number | null; // borrowed: the prey family whose main brain it started as
  caught: number; // prey caught this generation, all food maps it played
  maps: number; // food maps it played this generation
  resistGene: number; // rules.hunterResistGene: inborn poison resistance 0..1 (0 when off)
  poisonCost: number; // rules.hunterResistGene: meals lost to poison this generation (see POISON_MEALS)
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
  resist?: number; // rules.hunterResistGene: average resistance gene of the pool
}

// Breeding resistance by hand (rules.hunterResistGene, generations mode). Scores are in meals (a catch = 1 meal).
// From the ecosystem numbers (2026-11-02): poison level 1 costs an adult hunter hunterHunger 0.0025 x ~721 harm-ticks
// = 1.8 energy = 3.6 meals of 0.5; resistance r cuts that by (1 - r). Upkeep (the old resistUpkeep value, 0.0002 x r per tick) =
// 0.3 r energy = 0.6 r meals per 1500-tick map.
export const POISON_MEALS = 3.6;
export const UPKEEP_MEALS_PER_MAP = 0.6;

export const CATCH = 6; // a hunter this close to a prey catches it (same reach as eating)
export const REST = 30; // ticks a hunter rests after a catch
export const TURN = 0.2; // most a brain hunter turns per tick (radians), the same as prey

// rules.hunterCue (Rey 2026-11-06): what a hunter can read of a prey's sickness. 1 = its speed (poison slows prey, but healthy prey also
// choose to go slow, so the cue drifts and can flip: scripts/cue-quality.mjs); 2 = a glow, min(poison, 1), a mark the prey can't hide;
// 4 = a scent field: sick prey leave scent that fades (half-life SCENT_HALF ticks), so the memory lives in the world, not in the hunter.
// 3 and 5 = shuffled controls of 2 and 4: each prey shows the glow of the prey SHUFFLE_OFFSET places on in the creature list (same
// spread, no link to its own state). 0 = blind.
export const SHUFFLE_OFFSET = 7, SCENT_CELL = 20, SCENT_HALF = 100, SCENT_RING = 30;
const SCENT_KEEP = 0.9930924954370359; // 0.5 ** (1 / SCENT_HALF), written out (no pow at run time)
const SW = Math.ceil(W / SCENT_CELL), SH = Math.ceil(H / SCENT_CELL);
const cellOf = (x: number, y: number) =>
  Math.min(SH - 1, Math.max(0, Math.floor(y / SCENT_CELL))) * SW + Math.min(SW - 1, Math.max(0, Math.floor(x / SCENT_CELL)));
export function glowShown(w: World, i: number): number {
  const cs = w.creatures, cue = w.rules.hunterCue;
  const c = cue === 3 || cue === 5 ? cs[(i + SHUFFLE_OFFSET) % cs.length] : cs[i];
  return Math.min(c.toxin, 1);
}
// Once per ecosystem tick (rules.hunterCue 4/5): every cell fades; each live prey adds (1 - keep) x its shown glow to its cell, so a sick
// prey resting in one cell brings that cell toward its glow, and a passing one leaves a faint trail.
export function updateScent(w: World): void {
  const s = w.eco.scent;
  if (s.length !== SW * SH) { s.length = 0; for (let k = 0; k < SW * SH; k++) s.push(0); }
  for (let k = 0; k < s.length; k++) s[k] *= SCENT_KEEP;
  const cs = w.creatures;
  for (let i = 0; i < cs.length; i++) {
    if (!cs[i].alive) continue;
    const g = glowShown(w, i);
    if (g > 0) s[cellOf(cs[i].x, cs[i].y)] += (1 - SCENT_KEEP) * g;
  }
}
export function scentAt(w: World, x: number, y: number, walls: boolean): number {
  const s = w.eco.scent;
  if (!s.length) return 0;
  const px = walls ? x : ((x % W) + W) % W, py = walls ? y : ((y % H) + H) % H;
  return Math.min(s[cellOf(px, py)], 1);
}
// the scent sense: 16 points on a ring SCENT_RING px around the hunter, averaged per eye slice
const RING = Array.from({ length: 16 }, (_, p) => [SCENT_RING * cos((p * Math.PI) / 8), SCENT_RING * sin((p * Math.PI) / 8)]);
const ringSum = new Array(8).fill(0), ringN = new Array(8).fill(0);

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
      w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, speed: 0, brain: b, energy: 1, age: 0, toxin: 0, resist: 0 });
    }
    return;
  }
  for (let i = 0; i < w.rules.hunters; i++) w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, speed: 0, brain: null, energy: 1, age: 0, toxin: 0, resist: 0 });
}

const brainLength = (w: World) => genomeSize(hunterInputCount(w.rules), w.rules.hidden);
// rules.hunterBite (restored 2026-11-09, Rey: "choice"): the bite output's weights (one per middle neuron + a bias) ride at the end of the genome
const biteLength = (w: World) => (w.rules.hunterBite > 0 ? w.rules.hidden + 1 : 0);
const hunterGenomeLength = (w: World) => brainLength(w) + biteLength(w);

function newHunterBrain(w: World, g: Genome, origin: Origin, from: number | null, resistGene = 0): HunterBrain {
  const bl = brainLength(w);
  const bite = w.rules.hunterBite > 0;
  return {
    id: w.nextHunterId++, g, origin, from, caught: 0, maps: 0, a: 0, resistGene, poisonCost: 0, usual: 0,
    w: bite ? g.slice(0, bl) : w.rules.hunterLearn > 0 ? g.slice() : g, trace: w.rules.hunterLearn > 0 ? new Array(bl).fill(0) : [],
    inputs: new Array(hunterInputCount(w.rules)).fill(0), hidden: new Array(w.rules.hidden).fill(0), out: [0, 0],
  };
}

// The first hunters: borrowed and random alternate (borrowed first), the borrowed ones from the most
// recently extinct families, newest first. With fewer extinct families than borrowed seats, the rest are
// random (and tagged random: the tag says what the brain is, not what the seat was meant for).
export const poolSize = (w: World) => Math.max(w.rules.hunters, w.rules.hunterPool);

export function firstHunterBrains(w: World, n = poolSize(w)): HunterBrain[] {
  const len = hunterGenomeLength(w);
  // with the eye on, prey brains have another shape, so nothing can be borrowed: every first hunter is random
  const dead = eyeSlices(w.rules) > 0 || hunterEyeSlices(w.rules) > 0 || w.rules.hunterBite > 0 ? [] : w.legacy.filter((f) => f.ref.length >= len).reverse(); // newest first
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
    h.speed = 0;
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
    h.speed = step;
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
  h.rest = inEcosystem(w) && w.rules.digest > 0 ? 0 : REST; // rules.digest: the stomach is the wait, not a rest
  if (h.brain) h.brain.caught++;
  if (h.brain && w.rules.hunterResistGene > 0 && !inEcosystem(w)) h.brain.poisonCost += POISON_MEALS * w.rules.genPreyToxin * (1 - h.brain.resistGene);
  if (inEcosystem(w)) {
    const gut = w.rules.digest > 0; // rules.digest: the meal and its poison go to the stomach (gut.ts)
    if (gut) swallow(h, w.rules.hunterMeal, w.rules.hunterMeal, 0);
    else h.energy = Math.min(h.energy + w.rules.hunterMeal, MAX_ENERGY);
    const lv = prey.toxin;
    const bin = lv <= 0 ? 0 : lv <= 0.02 ? 1 : lv <= 0.05 ? 2 : lv <= SICK ? 3 : lv <= 0.3 ? 4 : 5;
    w.eco.dose.n[bin]++;
    if (prey.toxin > 0) {
      const plain = dose(prey.toxin, h.age, hunterLifeFor(w), w); // the prey's whole level, through the hunter's age resistance
      const raw = w.rules.potencyRise > 0 ? plain * w.eco.potency.hunter : plain; // rules.potencyRise: the hunter side's potency
      const taken = w.rules.hunterDoseCap > 0 ? Math.min(raw, w.rules.hunterDoseCap) : raw; // rules.hunterDoseCap
      w.eco.dose.taken[bin] += taken;
      if (gut) h.gut!.toxin += taken;
      else h.toxin += taken;
    }
    w.eco.caught++;
    w.eco.sick.caught++;
    w.eco.potency.catches++;
    if (prey.toxin > SICK) { w.eco.sick.caughtSick++; w.eco.potency.sickCatches++; }
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

// The hunters' raw eye (rules.hunterEye; Rey 2026-11-02): like the prey eye, K slices around the heading, each
// summing closeness (1 - d^2/200^2) of prey, of prey movement (closeness x speed / 3: a sick prey is slow, so it
// shows strong in "prey" and weak in "prey motion") and of other hunters; then energy and the wall. Returns k.
// Hangover (rules.hunterHangover, Rey 2026-11-13: "debuff, like shutting off one sense after the poison wears off"). For hunters the
// poison no longer raises hunger. While a hunter's poison is above SICK it is "high" (no debuff; with rules.hunterEarlyBreed it breeds
// early). When the poison falls back under SICK the hangover starts and lasts as long as the high did. 1 = it cannot see the sickness
// cue; 2 = its eye reaches half as far; 3 = both. Resistance counts: the level used is the harm (level x (1 - resistance)).
export const hungOver = (h: Hunter): boolean => (h.hang ?? 0) > 0;
const hangGlow = (w: World, h: Hunter): boolean => (w.rules.hunterHangover === 1 || w.rules.hunterHangover === 3) && hungOver(h);
const hangRange = (w: World, h: Hunter): boolean => w.rules.hunterHangover >= 2 && hungOver(h);
export function hangoverTick(h: Hunter): void {
  if (harm(h.toxin, h.resist) > SICK) h.high = (h.high ?? 0) + 1; // the party: the bill grows
  else if ((h.high ?? 0) > 0) { h.hang = (h.hang ?? 0) + h.high!; h.high = 0; } // it wore off: the hangover starts
  else if ((h.hang ?? 0) > 0) h.hang!--;
}

export function hunterEyeInto(w: World, h: Hunter, inputs: number[], cosH: number, sinH: number, K: number, walls: boolean, eco: boolean): number {
  const n = K * 3;
  for (let i = 0; i < n; i++) inputs[i] = 0;
  const hang = w.rules.hunterHangover > 0; // rules.hunterHangover: a hung-over hunter misses the cue and / or sees half as far
  const cs = w.creatures, cue = hang && hangGlow(w, h) ? 0 : w.rules.hunterCue;
  const reach = hang && hangRange(w, h) ? EYE_R2 / 4 : EYE_R2;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c.alive) continue;
    const dx = offset(c.x - h.x, W, walls);
    const dy = offset(c.y - h.y, H, walls);
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach) continue;
    const v = 1 - d2 / EYE_R2;
    const sl = eyeSlice(dx, dy, cosH, sinH, K);
    inputs[sl] += v;
    // the 2nd channel is the sickness cue (rules.hunterCue): speed (1), glow (2, 3); scent (4, 5) is read below; blind (0) stays 0
    if (cue === 1) inputs[K + sl] += v * Math.min(c.speed / 3, 1);
    else if (cue === 2 || cue === 3) inputs[K + sl] += v * glowShown(w, i);
  }
  if (cue >= 4) {
    for (let sl = 0; sl < K; sl++) { ringSum[sl] = 0; ringN[sl] = 0; }
    for (const [dx, dy] of RING) {
      const sl = eyeSlice(dx, dy, cosH, sinH, K);
      ringSum[sl] += scentAt(w, h.x + dx, h.y + dy, walls);
      ringN[sl]++;
    }
    for (let sl = 0; sl < K; sl++) inputs[K + sl] = ringN[sl] ? ringSum[sl] / ringN[sl] : 0;
  }
  for (const o of w.hunters) {
    if (o === h) continue;
    const dx = offset(o.x - h.x, W, walls);
    const dy = offset(o.y - h.y, H, walls);
    const d2 = dx * dx + dy * dy;
    if (d2 >= EYE_R2) continue;
    inputs[2 * K + eyeSlice(dx, dy, cosH, sinH, K)] += 1 - d2 / EYE_R2;
  }
  inputs[n] = eco ? h.energy : 1;
  if (w.rules.digest > 0) { inputs[n + 1] = fullness(h, w.rules.hunterMeal); return n + 2; } // rules.digest: how full its stomach is, 0..1
  return n + 1;
}

// Brain hunters: sense, think, turn and move like a creature (top speed rules.hunterSpeed), then catch the
// nearest prey if it is within reach. Resting hunters don't think or move.
function moveBrainHunters(w: World): void {
  const r = w.rules;
  const walls = r.walls > 0;
  const hs = w.hunters;
  const eco = inEcosystem(w);
  const hEye = hunterEyeSlices(r);
  for (let n = 0; n < hs.length; n++) {
    const h = hs[n];
    const b = h.brain!;
    h.speed = 0;
    if (h.rest > 0) {
      h.rest--;
      continue;
    }
    nearestPrey(w, h.x, h.y, walls);
    if (near.i1 < 0) continue; // nobody left to hunt
    const inputs = b.inputs;
    const cosH = cos(b.a);
    const sinH = sin(b.a);
    let k: number;
    if (hEye > 0) k = hunterEyeInto(w, h, inputs, cosH, sinH, hEye, walls, eco);
    else {
      k = writeTowards(inputs, 0, near.dx1, near.dy1, near.d21, cosH, sinH); // "food" = nearest prey
      if (r.digest > 0) { inputs[k++] = eco ? h.energy : 1; inputs[k++] = fullness(h, r.hunterMeal); } else
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
      if (r.poison > 0) {
        // ecosystem: the prey's "poison" sense becomes the nearest prey's direction and speed (in place of distance):
        // a slow prey reads like poison close by, so a borrowed prey brain starts out avoiding slow (maybe sick) prey
        if (eco && r.hunterCue > 0) {
          // rules.hunterCue: the nearest prey's speed (1), glow (2, 3) or the scent where it stands (4, 5), in place of its distance
          const p = w.creatures[near.i1];
          k = writeTowards(inputs, k, near.dx1, near.dy1, near.d21, cosH, sinH);
          inputs[k - 1] = r.hunterCue === 1 ? Math.min(p.speed / 3, 1) : r.hunterCue <= 3 ? glowShown(w, near.i1) : scentAt(w, p.x, p.y, walls);
        } else k = writeNothing(inputs, k);
      }
      if (r.hunterSense > 0) k = writeNothing(inputs, k); // prey have hunter inputs; for a hunter they read nothing
    }
    if (walls) inputs[k++] = wallAhead(h.x, h.y, b.a);
    if (inputs.length !== k) inputs.length = k;
    thinkInto(b.w, inputs, b.hidden, b.out);
    b.a += b.out[0] * TURN;
    let speed = ((b.out[1] + 1) / 2) * r.hunterSpeed;
    if (r.hunterResistSlow > 0) speed *= 1 - r.hunterResistSlow * b.resistGene; // resistance costs speed
    h.speed = speed;
    if (walls) {
      h.x = Math.min(Math.max(h.x + cos(b.a) * speed, 0), W);
      h.y = Math.min(Math.max(h.y + sin(b.a) * speed, 0), H);
    } else {
      h.x = (h.x + cos(b.a) * speed + W) % W;
      h.y = (h.y + sin(b.a) * speed + H) % H;
    }
    nearestPrey(w, h.x, h.y, walls);
    const toxinBefore = h.gut ? h.toxin + gutToxin(h) : h.toxin; // with a stomach, the poison just swallowed counts for the taste
    // rules.digest: a hunter with a full stomach cannot catch (its stomach holds one meal)
    const inReach = near.i1 >= 0 && near.d21 < CATCH * CATCH && (!(eco && r.digest > 0) || hasRoom(h, r.hunterMeal, r.hunterMeal));
    let caughtNow = inReach;
    if (inReach && r.hunterBite > 0) {
      // the bite output: weights after the brain in the genome, read from the middle neurons of this tick's thought
      const hid = b.hidden, g = b.g, k0 = g.length - hid.length - 1;
      let s = g[g.length - 1] + r.hunterBite; // rules.hunterBite is also the start bias toward biting (don't starve at start)
      for (let i = 0; i < hid.length; i++) s += hid[i] * g[k0 + i];
      caughtNow = tanh(s) > 0;
      const sick = w.creatures[near.i1].toxin > SICK, d = w.eco.dose;
      (sick ? d.biteSick : d.biteClean)[caughtNow ? 0 : 1]++;
    }
    if (caughtNow && eco) {
      // counting only (Rey 2026-11-02): was the prey ahead of the hunter (chased) or to the side / behind (bumped into)?
      const d = Math.sqrt(near.d21);
      const c = d > 0 ? (near.dx1 * cos(b.a) + near.dy1 * sin(b.a)) / d : 1;
      const dir = c > Math.SQRT1_2 ? 0 : c >= 0 ? 1 : 2;
      (w.creatures[near.i1].toxin > SICK ? w.eco.dose.dirSick : w.eco.dose.dirClean)[dir]++;
      // zero point (counting only, Rey 2026-11-04): how sick the OTHER prey are, in the whole world and near this hunter
      const z = w.eco.dose.zero, cs = w.creatures;
      let n = 0, s = 0, n50 = 0, s50 = 0, n200 = 0, s200 = 0, n25 = 0, s25 = 0, n12 = 0, s12 = 0;
      for (let i = 0; i < cs.length; i++) {
        const o = cs[i];
        if (!o.alive || i === near.i1) continue;
        const sk = o.toxin > SICK ? 1 : 0, ox = offset(o.x - h.x, W, walls), oy = offset(o.y - h.y, H, walls), d2 = ox * ox + oy * oy;
        n++; s += sk;
        if (d2 < 2500) { n50++; s50 += sk; }
        if (d2 < 40000) { n200++; s200 += sk; }
        if (d2 < 625) { n25++; s25 += sk; }
        if (d2 < 144) { n12++; s12 += sk; }
      }
      if (n) { z[0]++; z[1] += s / n; }
      if (n50) { z[2]++; z[3] += s50 / n50; }
      if (n200) { z[4]++; z[5] += s200 / n200; }
      if (n25) { z[6]++; z[7] += s25 / n25; }
      if (n12) { z[8]++; z[9] += s12 / n12; }
    }
    if (caughtNow) catchPrey(w, h, w.creatures[near.i1]);
    // taste aversion (Rey 2026-10-25): a hunter learns during its life, like prey do. A clean catch is +1; a poisoned
    // one counts down to -1 by the poison it took in, so what led it to that prey (including how fast it moved) fades
    if (eco && r.hunterLearn > 0) {
      const reward = caughtNow ? 1 - 2 * Math.min(1, (h.gut ? h.toxin + gutToxin(h) : h.toxin) - toxinBefore) : 0;
      let felt = reward;
      if (r.relativeReward > 0) {
        felt = reward - b.usual; // better or worse than usual: zero on average, so no steady drift (as prey relativeReward)
        b.usual += USUAL_RATE * (reward - b.usual);
      }
      learn(b.w, b.trace, inputs, b.hidden, b.out, felt, r.hunterLearn, LEARN_DECAY);
      if (r.forget > 0) { const wk = b.w, gk = b.g; for (let k = 0; k < wk.length; k++) wk[k] += r.forget * (gk[k] - wk[k]); }
    }
  }
}

// After a generation (brain hunters that have arrived): record how they did, then breed the next hunters.
// Score = catches per map played (a brain that played no map this generation ranks last). The best is
// copied unchanged; the others are children of the better half, nudged by rules.mutation. A child keeps
// its parent's origin tag. The pool keeps its size (poolSize).
export function breedHunters(w: World): void {
  const bs = w.hunterBrains;
  if (bs.length === 0) return;
  const gene = w.rules.hunterResistGene > 0;
  // with the resistance gene the judge scores net meals per map: catches minus poison minus upkeep
  const rate = (b: HunterBrain) => (b.maps > 0 ? (gene ? (b.caught - b.poisonCost) / b.maps - UPKEEP_MEALS_PER_MAP * b.resistGene : b.caught / b.maps) : -Infinity);
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
    ...(gene ? { resist: bs.reduce((s, b) => s + b.resistGene, 0) / bs.length } : {}),
  });
  const n = poolSize(w);
  const parents = Math.max(1, Math.ceil(ranked.length / 2));
  const next: HunterBrain[] = [newHunterBrain(w, ranked[0].g, ranked[0].origin, ranked[0].from, ranked[0].resistGene)];
  while (next.length < n) {
    const p = ranked[Math.floor(w.hrng.next() * parents)];
    const g = p.g.map((x) => x + w.hrng.gauss() * w.rules.mutation);
    const r = gene ? Math.min(1, Math.max(0, p.resistGene + w.hrng.gauss() * w.rules.mutation)) : 0; // no draw when off
    next.push(newHunterBrain(w, g, p.origin, p.from, r));
  }
  w.hunterBrains = next;
}

// ---------- ecosystem mode (Rey's brief 2026-10-23) ----------
// Hunters live like prey: energy drains every tick (rules.hunterHunger), a catch refills it
// (rules.hunterMeal), a hunter with rules.hunterBirth energy may split off a baby with half its energy and a
// mutated copy of its brain, and a hunter dies when its energy runs out or at rules.hunterAge.
// Babies (Rey 2026-10-23): only adults (age rules.hunterMature or more), and older is harder: a full adult
// has a baby with chance rules.hunterBirthChance per tick just after maturing, falling to 0 at hunterAge. When one
// side dies out, the round ends and that side restarts from its best brains so far (hunters: most prey
// caught in a lifetime; prey: longest life); the other side carries on as it is.

export const MAX_ENERGY = 1.5; // the most a hunter can hold (the same as prey)
export const HUNTER_CAP = 300; // safety limit for speed, not a game rule: hunter births pause at it
export const BEST_KEEP = 8; // best brains remembered per side for a restart

export interface BestBrain {
  g: Genome;
  score: number; // hunters: prey caught in its life; prey: ticks lived
  origin: Origin;
  from: number | null;
  depth?: number; // prey: births since its founder (stats only), carried through a restart
  resist?: number; // rules.resistGene: its inborn poison resistance, carried through a restart
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
  return { x, y, rest: 0, speed: 0, brain, energy, age: 0, toxin: 0, resist: 0 };
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
    if (r.digest > 0) digestTick(h, hunterDigest(r), MAX_ENERGY); // rules.digest: the stomach feeds the body (gut.ts)
    // rules.hunterIdle: a still hunter pays only that share of its hunger, a hunter at top speed all of it (off: all of it at any speed)
    const effort = r.hunterIdle > 0 ? r.hunterIdle + (1 - r.hunterIdle) * Math.min(h.speed / r.hunterSpeed, 1) : 1;
    if (r.hunterHangover > 0) { h.energy -= r.hunterIdle > 0 ? r.hunterHunger * effort : r.hunterHunger; hangoverTick(h); } // the hangover replaces the hunger harm
    else h.energy -= (r.hunterIdle > 0 ? r.hunterHunger * effort : r.hunterHunger) * (1 + harm(h.toxin, h.resist)); // poison: hunger costs more
    if (r.resistGene > 0 && h.resist > 0) h.energy -= r.resistGene * r.hunterHunger * h.resist; // inborn resistance has an upkeep: a share of the body's burn
    h.toxin = fadeHunter(h.toxin, w); // rules.hunterPoisonHalfLife: hunters may clear poison faster than prey
    h.age++;
    const adult = h.age >= r.hunterMature;
    const fertile = adult ? 1 - (h.age - r.hunterMature) / Math.max(1, r.hunterAge - r.hunterMature) : 0;
    // rules.hunterEarlyBreed: a poisoned hunter breeds at lower energy (down by this share at harm 1 or more): breed early, in case it dies early
    const birthAt = r.hunterEarlyBreed > 0 ? r.hunterBirth * (1 - r.hunterEarlyBreed * Math.min(1, harm(h.toxin, h.resist))) : r.hunterBirth;
    if (adult && h.energy >= birthAt && w.hunters.length + born.length < HUNTER_CAP && w.hrng.next() < r.hunterBirthChance * fertile) {
      const half = h.energy / 2;
      h.energy -= half;
      const p = h.brain!;
      // rules.hunterBrainNow: the baby starts from what the parent's brain is NOW (its learned weights; the bite weights stay the inborn ones)
      const from = r.hunterBrainNow > 0 && p.w !== p.g ? (p.w.length < p.g.length ? [...p.w, ...p.g.slice(p.w.length)] : p.w) : p.g;
      const child = newHunterBrain(w, from.map((x) => x + w.hrng.gauss() * r.mutation), p.origin, p.from);
      const baby = newEcoHunter(w, child, place(h.x + (w.hrng.next() - 0.5) * 10, W), place(h.y + (w.hrng.next() - 0.5) * 10, H), half);
      if (r.resistGene > 0) baby.resist = babyResist(h.resist, w.hrng.gauss()); // inborn resistance (toxin.ts)
      born.push(baby);
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
    // rules.hunterRealLife: every death (starved or old) moves the hunters' average lifespan 1% of the way, as for prey (toxin.ts)
    if (r.hunterRealLife > 0) w.eco.hunterLife = w.eco.hunterLife > 0 ? w.eco.hunterLife + PREY_LIFE_RATE * (h.age - w.eco.hunterLife) : h.age;
    const hm = harm(h.toxin, h.resist);
    w.eco.dose.deaths++;
    w.eco.dose.deathHarm += 1 + hm;
    if (hm > 0.5) w.eco.dose.deathsHarmed++;
    if (old) w.eco.hunterOldAge++;
    const b = h.brain!;
    remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from, resist: h.resist });
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
    const nh = newEcoHunter(w, brain, w.hrng.next() * W, w.hrng.next() * H, 1);
    if (src) nh.resist = src.resist ?? 0; // rules.resistGene: a restart keeps the remembered resistance
    w.hunters.push(nh);
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
    remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from, resist: h.resist });
  }
  if (n >= 2) {
    const g = Array.from({ length: hunterGenomeLength(w) }, () => w.hrng.gauss() * 0.5);
    keep.push(newEcoHunter(w, newHunterBrain(w, g, "random", null), w.hrng.next() * W, w.hrng.next() * H, 1));
  }
  w.hunters = keep;
}

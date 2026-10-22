// What a creature perceives each tick. Which senses exist is set by the rules; each one adds inputs
// to the brain, so the brain (and the genome) grows with them.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature, Food } from "./creature.ts";
import { IN } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { CELL, Grid, H, RING_OX, RING_OY, RINGS, SPATIAL, W, cellAt, cellOf, nearestBruteInto, nearestOneInto, offset, type Hit, type Near } from "./space.ts";

export interface SenseRules {
  senseFood2: number; // 1 = also sense the second-nearest food
  senseCreature: number; // 1 = sense the nearest other living creature
  walls: number; // 1 = the map has walls instead of wrapping around, and creatures sense the wall ahead
  poison: number; // share of food that is poison; above 0, creatures also sense the nearest poison
  hunters?: number; // hunters on the map; above 0 (with hunterSense), prey sense the nearest one
  hunterSense?: number;
}

const sensesHunter = (r: SenseRules) => (r.hunters ?? 0) > 0 && (r.hunterSense ?? 1) > 0;

export function inputCount(r: SenseRules): number {
  return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.poison > 0 ? 3 : 0) + (sensesHunter(r) ? 3 : 0) + (r.walls ? 1 : 0);
}

export function inputLabels(r: SenseRules): string[] {
  const labels = ["Food left/right", "Food ahead", "Food distance", "Energy"];
  if (r.senseFood2) labels.push("2nd food left/right", "2nd food ahead", "2nd food distance");
  if (r.senseCreature) labels.push("Neighbour left/right", "Neighbour ahead", "Neighbour distance");
  if (r.poison > 0) labels.push("Poison left/right", "Poison ahead", "Poison distance");
  if (sensesHunter(r)) labels.push("Hunter left/right", "Hunter ahead", "Hunter distance");
  if (r.walls) labels.push("Wall distance ahead");
  return labels;
}

// Where something is, seen from the creature: left/right (-1..1), ahead (-1..1), distance (0..1, 1 = 200 or more).
// The direction to the target is (dx, dy) / d; turning it into the creature's frame is a rotation by the
// heading, so no angle (and no atan2) is needed: sin(t - h) = sin t cos h - cos t sin h, and so on.
function towards(dx: number, dy: number, d2: number, cosH: number, sinH: number): [number, number, number] {
  const d = Math.sqrt(d2);
  const ok = d > 0 && d !== Infinity;
  const st = ok ? dy / d : 0; // sin and cos of the target's direction; "straight ahead" if unknown
  const ct = ok ? dx / d : 1;
  return [st * cosH - ct * sinH, ct * cosH + st * sinH, Math.min(d / 200, 1)];
}

const NOTHING: [number, number, number] = [0, 0, 1]; // nothing there: straight ahead is unknown, far away

// Distance to the wall straight ahead, 0..1 (1 = 200 or more).
export function wallAhead(x: number, y: number, heading: number): number {
  const cx = cos(heading);
  const cy = sin(heading);
  const tx = cx > 0 ? (W - x) / cx : cx < 0 ? -x / cx : Infinity;
  const ty = cy > 0 ? (H - y) / cy : cy < 0 ? -y / cy : Infinity;
  return Math.min(Math.min(tx, ty) / 200, 1);
}

// What a pellet looks like: a purple ring (true) or a green dot. Normally poison is the purple ring;
// with rules.swapKinds the looks swap roles on some food maps. Creatures sense the look, not the truth.
export function looksPoison(w: World, f: Food): boolean {
  return f.poison !== w.swapped;
}

export interface Perception {
  inputs: number[];
  food: Food | null; // nearest food, for eating
  foodDist: number;
}

export interface FoodScan {
  good: Near<Food>[]; // nearest pellet(s) that look like food (green dots), nearest first (1, or 2 with senseFood2)
  poison: Near<Food> | undefined; // nearest pellet that looks like poison (purple ring); see rules.swapKinds
}

// One pass over the food finds the nearest good pellet(s) and the nearest poison together. (It used to be
// one nearest() call per kind, each scanning every pellet: the senses were 2/3 of all run time.)
// Pellets that have not regrown yet are skipped. Same answers as nearest(): ties keep the earlier pellet.
// What a food search found, kept in one reusable object (the every-tick path makes no garbage):
// good[0..goodN-1] = nearest pellets that look like food, nearest first; poison = nearest that looks
// like poison (when hasPoison). idx = the pellet's index in w.food (ties go to the lower index).
export interface FoodHits {
  goodN: number;
  good: [Hit<Food> & { idx: number }, Hit<Food> & { idx: number }];
  hasPoison: boolean;
  poison: Hit<Food> & { idx: number };
}

export function newFoodHits(): FoodHits {
  const h = () => ({ item: null as Food | null, dx: 0, dy: 0, d2: 0, idx: -1 });
  return { goodN: 0, good: [h(), h()], hasPoison: false, poison: h() };
}

// Puts pellet j (at dx, dy, d2) into the good list if it belongs there. byIndex: break equal distances
// by index (the grid visits pellets out of order); the one-pass scan visits them in order, so an equal
// distance found later never moves ahead.
function addGood(h: FoodHits, goodCount: number, f: Food, j: number, dx: number, dy: number, d2: number, byIndex: boolean): void {
  const g = h.good;
  let i = h.goodN;
  if (i === goodCount) {
    const last = g[i - 1];
    if (!(d2 < last.d2 || (byIndex && d2 === last.d2 && j < last.idx))) return;
    i--;
  } else h.goodN++;
  while (i > 0 && (d2 < g[i - 1].d2 || (byIndex && d2 === g[i - 1].d2 && j < g[i - 1].idx))) {
    const from = g[i - 1];
    const to = g[i];
    to.item = from.item;
    to.dx = from.dx;
    to.dy = from.dy;
    to.d2 = from.d2;
    to.idx = from.idx;
    i--;
  }
  const t = g[i];
  t.item = f;
  t.dx = dx;
  t.dy = dy;
  t.d2 = d2;
  t.idx = j;
}

function toScan(h: FoodHits): FoodScan {
  const good: Near<Food>[] = [];
  for (let i = 0; i < h.goodN; i++) good.push({ item: h.good[i].item!, dx: h.good[i].dx, dy: h.good[i].dy, d2: h.good[i].d2 });
  const p = h.poison;
  return { good, poison: h.hasPoison ? { item: p.item!, dx: p.dx, dy: p.dy, d2: p.d2 } : undefined };
}

export function scanFood(w: World, x: number, y: number, goodCount: number): FoodScan {
  const h = newFoodHits();
  scanFoodInto(h, w, x, y, goodCount);
  return toScan(h);
}

export function scanFoodInto(h: FoodHits, w: World, x: number, y: number, goodCount: number): void {
  const walls = w.rules.walls > 0;
  const tick = w.tick;
  const swapped = w.swapped;
  const food = w.food;
  const halfW = W / 2;
  const halfH = H / 2;
  h.goodN = 0;
  h.hasPoison = false;
  const p = h.poison;
  for (let j = 0; j < food.length; j++) {
    const f = food[j];
    if (f.readyAt > tick) continue;
    let dx = f.x - x;
    let dy = f.y - y;
    if (!walls) {
      if (dx > halfW) dx -= W;
      else if (dx < -halfW) dx += W;
      if (dy > halfH) dy -= H;
      else if (dy < -halfH) dy += H;
    }
    const d2 = dx * dx + dy * dy;
    if (f.poison !== swapped) { // looksPoison, inlined
      if (!h.hasPoison || d2 < p.d2) {
        h.hasPoison = true;
        p.item = f;
        p.dx = dx;
        p.dy = dy;
        p.d2 = d2;
        p.idx = j;
      }
      continue;
    }
    addGood(h, goodCount, f, j, dx, dy, d2, false);
  }
}

// The grids for one tick: built before anyone moves, kept up to date as creatures move and food respawns
// (life.ts), dropped after the tick. Off (null) when SPATIAL.on is false: then every search is brute force.
export interface Grids {
  food: Grid;
  creatures: Grid;
  foodOn: boolean; // used this tick (enough food to pay off, SPATIAL.foodFrom)
  creaturesOn: boolean; // used this tick (enough creatures, SPATIAL.creaturesFrom)
  poisonLooks: number; // pellets that look like poison (ready or not): when all are checked, stop looking
}

const gridCache = new WeakMap<World, Grids>(); // reused tick after tick (no new arrays every tick)

export function prepareGrids(w: World): void {
  const foodOn = SPATIAL.on && w.food.length >= SPATIAL.foodFrom;
  const creaturesOn = SPATIAL.on && w.rules.senseCreature > 0 && w.creatures.length >= SPATIAL.creaturesFrom;
  if (!foodOn && !creaturesOn) {
    w.grids = null;
    return;
  }
  const g = gridCache.get(w) ?? { food: new Grid(), creatures: new Grid(), foodOn, creaturesOn, poisonLooks: 0 };
  gridCache.set(w, g);
  w.grids = g;
  g.foodOn = foodOn;
  g.creaturesOn = creaturesOn;
  if (foodOn) {
    g.food.build(w.food);
    let p = 0;
    for (let i = 0; i < w.food.length; i++) {
      w.food[i].slot = i;
      if (looksPoison(w, w.food[i])) p++;
    }
    g.poisonLooks = p;
  }
  if (creaturesOn) {
    g.creatures.build(w.creatures);
    for (let i = 0; i < w.creatures.length; i++) w.creatures[i].slot = i;
  }
}

// scanFood with the grid: same answers (ties go to the lower index, as in the one-pass scan).
export function scanFoodGrid(w: World, g: Grids, x: number, y: number, goodCount: number): FoodScan {
  const h = newFoodHits();
  scanFoodGridInto(h, w, g, x, y, goodCount);
  return toScan(h);
}

export function scanFoodGridInto(h: FoodHits, w: World, g: Grids, x: number, y: number, goodCount: number): void {
  const walls = w.rules.walls > 0;
  const tick = w.tick;
  const food = w.food;
  const swapped = w.swapped;
  const halfW = W / 2;
  const halfH = H / 2;
  h.goodN = 0;
  h.hasPoison = false;
  const p = h.poison;
  const goodLooks = food.length - g.poisonLooks;
  let goodSeen = 0;
  let poisonSeen = 0;
  const grid = g.food;
  const home = cellOf(x, y);
  const stamp = grid.nextStamp();
  const seen = grid.seen;
  for (let r = 0; r <= RINGS; r++) {
    const rx = RING_OX[r];
    const ry = RING_OY[r];
    for (let t = 0; t < rx.length; t++) {
      const k = cellAt(home, rx[t], ry[t], walls);
      if (k < 0 || seen[k] === stamp) continue;
      seen[k] = stamp;
      const list = grid.cells[k];
      for (let n = 0; n < list.length; n++) {
        const j = list[n];
        const f = food[j];
        const isP = f.poison !== swapped; // looksPoison, inlined
        if (isP) poisonSeen++;
        else goodSeen++;
        if (f.readyAt > tick) continue;
        let dx = f.x - x;
        let dy = f.y - y;
        if (!walls) {
          if (dx > halfW) dx -= W;
          else if (dx < -halfW) dx += W;
          if (dy > halfH) dy -= H;
          else if (dy < -halfH) dy += H;
        }
        const d2 = dx * dx + dy * dy;
        if (isP) {
          if (!h.hasPoison || d2 < p.d2 || (d2 === p.d2 && j < p.idx)) {
            h.hasPoison = true;
            p.item = f;
            p.dx = dx;
            p.dy = dy;
            p.d2 = d2;
            p.idx = j;
          }
          continue;
        }
        addGood(h, goodCount, f, j, dx, dy, d2, true);
      }
    }
    const bound = r * r * CELL * CELL;
    const goodDone = goodSeen === goodLooks || (h.goodN === goodCount && h.good[goodCount - 1].d2 < bound);
    const poisonDone = poisonSeen === g.poisonLooks || (h.hasPoison && p.d2 < bound);
    if (goodDone && poisonDone) break;
  }
}

// Writes (dx, dy) as seen from the creature into inputs[k..k+2]: left/right, ahead, distance. Same
// numbers as towards() (nothing there: d2 = Infinity).
function writeTowards(inputs: number[], k: number, dx: number, dy: number, d2: number, cosH: number, sinH: number): number {
  const d = Math.sqrt(d2);
  const ok = d > 0 && d !== Infinity;
  const st = ok ? dy / d : 0;
  const ct = ok ? dx / d : 1;
  inputs[k] = st * cosH - ct * sinH;
  inputs[k + 1] = ct * cosH + st * sinH;
  inputs[k + 2] = Math.min(d / 200, 1);
  return k + 3;
}

function writeNothing(inputs: number[], k: number): number {
  inputs[k] = NOTHING[0];
  inputs[k + 1] = NOTHING[1];
  inputs[k + 2] = NOTHING[2];
  return k + 3;
}

export function sense(w: World, c: Creature): Perception {
  const saved = c.inputs;
  c.inputs = new Array(inputCount(w.rules)).fill(0);
  const seen = senseInto(w, c);
  const result = { inputs: c.inputs, food: seen.food, foodDist: seen.foodDist };
  c.inputs = saved;
  return result;
}

// Reused by senseInto (one creature at a time, never two at once).
const foodHits = newFoodHits();
const creatureHit: Hit<Creature> = { item: null, dx: 0, dy: 0, d2: 0 };
const perceived: { food: Food | null; foodDist: number } = { food: null, foodDist: Infinity };

// sense() for the every-tick path: writes the inputs into c.inputs and returns what it would eat in a
// reused object (read it before the next creature senses). Identical numbers, no garbage.
export function senseInto(w: World, c: Creature): { food: Food | null; foodDist: number } {
  const r = w.rules;
  const walls = r.walls > 0;
  const g = w.grids;
  const h = foodHits;
  if (g !== null && g.foodOn) scanFoodGridInto(h, w, g, c.x, c.y, r.senseFood2 ? 2 : 1);
  else scanFoodInto(h, w, c.x, c.y, r.senseFood2 ? 2 : 1);
  const inputs = c.inputs;
  const cosH = cos(c.a);
  const sinH = sin(c.a);
  const f = h.goodN > 0 ? h.good[0] : null;
  // no food at all: the distance reads as far (same numbers as always)
  let k = f ? writeTowards(inputs, 0, f.dx, f.dy, f.d2, cosH, sinH) : writeTowards(inputs, 0, 0, 0, Infinity, cosH, sinH);
  inputs[k++] = c.energy;
  if (r.senseFood2) {
    const s2 = h.goodN > 1 ? h.good[1] : null;
    k = s2 ? writeTowards(inputs, k, s2.dx, s2.dy, s2.d2, cosH, sinH) : writeNothing(inputs, k);
  }
  if (r.senseCreature) {
    const found = g !== null && g.creaturesOn
      ? nearestOneInto(creatureHit, g.creatures, w.creatures, c.x, c.y, walls, c, true)
      : nearestBruteInto(creatureHit, w.creatures, c.x, c.y, walls, c, true);
    k = found ? writeTowards(inputs, k, creatureHit.dx, creatureHit.dy, creatureHit.d2, cosH, sinH) : writeNothing(inputs, k);
  }
  const p = h.hasPoison ? h.poison : null;
  if (r.poison > 0) k = p ? writeTowards(inputs, k, p.dx, p.dy, p.d2, cosH, sinH) : writeNothing(inputs, k);
  if (sensesHunter(r)) {
    let bdx = 0;
    let bdy = 0;
    let bd2 = Infinity;
    for (const hu of w.hunters) {
      const dx = offset(hu.x - c.x, W, walls);
      const dy = offset(hu.y - c.y, H, walls);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) {
        bd2 = d2;
        bdx = dx;
        bdy = dy;
      }
    }
    k = bd2 < Infinity ? writeTowards(inputs, k, bdx, bdy, bd2, cosH, sinH) : writeNothing(inputs, k);
  }
  if (walls) inputs[k++] = wallAhead(c.x, c.y, c.a);
  if (inputs.length !== k) inputs.length = k;
  // what it would eat: the nearest pellet of either kind (good wins a tie)
  const eat = p && (!f || p.d2 < f.d2) ? p : f;
  perceived.food = eat ? eat.item : null;
  perceived.foodDist = eat ? Math.sqrt(eat.d2) : Infinity;
  return perceived;
}

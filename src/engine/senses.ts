// What a creature perceives each tick. Which senses exist is set by the rules; each one adds inputs
// to the brain, so the brain (and the genome) grows with them.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature, Food } from "./creature.ts";
import { IN } from "./brain.ts";
import { cos, sin } from "./dmath.ts";
import { CELL, Grid, H, RING_OX, RING_OY, RINGS, SPATIAL, W, cellAt, cellOf, nearest, nearestOne, type Near } from "./space.ts";

export interface SenseRules {
  senseFood2: number; // 1 = also sense the second-nearest food
  senseCreature: number; // 1 = sense the nearest other living creature
  walls: number; // 1 = the map has walls instead of wrapping around, and creatures sense the wall ahead
  poison: number; // share of food that is poison; above 0, creatures also sense the nearest poison
}

export function inputCount(r: SenseRules): number {
  return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.poison > 0 ? 3 : 0) + (r.walls ? 1 : 0);
}

export function inputLabels(r: SenseRules): string[] {
  const labels = ["Food left/right", "Food ahead", "Food distance", "Energy"];
  if (r.senseFood2) labels.push("2nd food left/right", "2nd food ahead", "2nd food distance");
  if (r.senseCreature) labels.push("Neighbour left/right", "Neighbour ahead", "Neighbour distance");
  if (r.poison > 0) labels.push("Poison left/right", "Poison ahead", "Poison distance");
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
export function scanFood(w: World, x: number, y: number, goodCount: number): FoodScan {
  const walls = w.rules.walls > 0;
  const tick = w.tick;
  const halfW = W / 2;
  const halfH = H / 2;
  const good: Near<Food>[] = [];
  let poison: Near<Food> | undefined;
  for (const f of w.food) {
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
    if (looksPoison(w, f)) {
      if (poison === undefined || d2 < poison.d2) poison = { item: f, dx, dy, d2 };
      continue;
    }
    if (good.length === goodCount && d2 >= good[goodCount - 1].d2) continue;
    let i = good.length === goodCount ? goodCount - 1 : good.length;
    while (i > 0 && d2 < good[i - 1].d2) {
      good[i] = good[i - 1];
      i--;
    }
    good[i] = { item: f, dx, dy, d2 };
  }
  return { good, poison };
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
  const walls = w.rules.walls > 0;
  const tick = w.tick;
  const food = w.food;
  const swapped = w.swapped;
  const halfW = W / 2;
  const halfH = H / 2;
  const good: Near<Food>[] = [];
  const goodIdx: number[] = [];
  let poison: Near<Food> | undefined;
  let poisonIdx = -1;
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
          if (poison === undefined || d2 < poison.d2 || (d2 === poison.d2 && j < poisonIdx)) {
            poison = { item: f, dx, dy, d2 };
            poisonIdx = j;
          }
          continue;
        }
        // insert into good (nearest first; equal distance: lower index first), keeping goodCount
        let i = good.length;
        if (i === goodCount) {
          const last = good[i - 1];
          if (d2 > last.d2 || (d2 === last.d2 && j > goodIdx[i - 1])) continue;
          i--;
        }
        while (i > 0 && (d2 < good[i - 1].d2 || (d2 === good[i - 1].d2 && j < goodIdx[i - 1]))) {
          good[i] = good[i - 1];
          goodIdx[i] = goodIdx[i - 1];
          i--;
        }
        good[i] = { item: f, dx, dy, d2 };
        goodIdx[i] = j;
      }
    }
    const bound = r * r * CELL * CELL;
    const goodDone = goodSeen === goodLooks || (good.length === goodCount && good[goodCount - 1].d2 < bound);
    const poisonDone = poisonSeen === g.poisonLooks || (poison !== undefined && poison.d2 < bound);
    if (goodDone && poisonDone) break;
  }
  return { good, poison };
}

export function sense(w: World, c: Creature): Perception {
  const r = w.rules;
  const walls = r.walls > 0;
  const g = w.grids;
  const useFood = g !== null && g.foodOn;
  const useCreatures = g !== null && g.creaturesOn;
  const scan = useFood ? scanFoodGrid(w, g!, c.x, c.y, r.senseFood2 ? 2 : 1) : scanFood(w, c.x, c.y, r.senseFood2 ? 2 : 1);
  const foods = scan.good;
  const f = foods[0];
  const p = scan.poison;
  // no food at all: same numbers as before senses were split out (distance reads as far)
  const cosH = cos(c.a);
  const sinH = sin(c.a);
  const first = f ? towards(f.dx, f.dy, f.d2, cosH, sinH) : towards(0, 0, Infinity, cosH, sinH);
  const inputs = [...first, c.energy];
  if (r.senseFood2) {
    const s = foods[1];
    inputs.push(...(s ? towards(s.dx, s.dy, s.d2, cosH, sinH) : NOTHING));
  }
  if (r.senseCreature) {
    const n = useCreatures
      ? nearestOne(g!.creatures, w.creatures, c.x, c.y, walls, c, true)
      : nearest(w.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
    inputs.push(...(n ? towards(n.dx, n.dy, n.d2, cosH, sinH) : NOTHING));
  }
  if (r.poison > 0) inputs.push(...(p ? towards(p.dx, p.dy, p.d2, cosH, sinH) : NOTHING));
  if (walls) inputs.push(wallAhead(c.x, c.y, c.a));
  // what it would eat: the nearest pellet of either kind (good wins a tie)
  const eat = p && (!f || p.d2 < f.d2) ? p : f;
  return { inputs, food: eat ? eat.item : null, foodDist: eat ? Math.sqrt(eat.d2) : Infinity };
}

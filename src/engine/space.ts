// The map: its size, how distances work, and the one lookup every sense uses.
export const W = 800;
export const H = 600;

export interface Point {
  x: number;
  y: number;
}

// The world wraps around, so take the short way.
export function wrapDelta(d: number, size: number): number {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

// Offset along one axis: the short way round when the world wraps, straight across when it has walls.
export function offset(d: number, size: number, walls: boolean): number {
  return walls ? d : wrapDelta(d, size);
}

export interface Near<T> {
  item: T;
  dx: number;
  dy: number;
  d2: number; // squared distance
}

// The `count` nearest items to (x, y), nearest first; ties keep the earlier item.
// Brute force: checks every item. Cheap at current sizes (measured); switch to a uniform grid when a
// measurement says this is the slow part. Written as a plain loop with no objects per item: it runs
// for every creature every tick.
export function nearest<T extends Point>(
  items: readonly T[], x: number, y: number, walls: boolean, count: number, skip?: (item: T) => boolean,
): Near<T>[] {
  const found: T[] = [];
  const fdx: number[] = [];
  const fdy: number[] = [];
  const fd2: number[] = [];
  const halfW = W / 2;
  const halfH = H / 2;
  for (let j = 0; j < items.length; j++) {
    const item = items[j];
    if (skip !== undefined && skip(item)) continue;
    let dx = item.x - x;
    let dy = item.y - y;
    if (!walls) {
      // same as wrapDelta, inlined
      if (dx > halfW) dx -= W;
      else if (dx < -halfW) dx += W;
      if (dy > halfH) dy -= H;
      else if (dy < -halfH) dy += H;
    }
    const d2 = dx * dx + dy * dy;
    let i = found.length;
    if (i === count && d2 >= fd2[count - 1]) continue;
    if (i === count) i--; // drop the current last
    while (i > 0 && d2 < fd2[i - 1]) {
      found[i] = found[i - 1];
      fdx[i] = fdx[i - 1];
      fdy[i] = fdy[i - 1];
      fd2[i] = fd2[i - 1];
      i--;
    }
    found[i] = item;
    fdx[i] = dx;
    fdy[i] = dy;
    fd2[i] = d2;
  }
  return found.map((item, i) => ({ item, dx: fdx[i], dy: fdy[i], d2: fd2[i] }));
}

// ---------- uniform grid (faster nearest-item search) ----------
// The map is cut into CELL x CELL squares; each square lists the items (by their index in the item
// array) inside it. A search looks at the squares around the point, ring by ring, and stops once no
// unvisited square can hold anything closer. Answers are identical to nearest(): same items, same
// distances, and ties go to the earlier item (lower index). Measured 2026-10-21: senses were about half
// of all run time at default sizes and over 80% in big worlds. Plain loops only (no closures per search
// or per item): a first version with callbacks was 2.5x SLOWER than brute force at default sizes.
export const CELL = 100; // 8 x 6 squares on the 800 x 600 map
export const GW = W / CELL;
export const GH = H / CELL;
const MAX_R = Math.max(GW, GH);

// Ring r = the squares whose offset (ox, oy) from the home square has max(|ox|, |oy|) = r.
export const RING_OX: number[][] = [];
export const RING_OY: number[][] = [];
for (let r = 0; r <= MAX_R; r++) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      xs.push(ox);
      ys.push(oy);
    }
  }
  RING_OX.push(xs);
  RING_OY.push(ys);
}
export const RINGS = MAX_R;

// Grid search on or off. Results are identical either way (tests switch it off to prove it); on is
// only faster when there is enough to search (see gridPays).
// Measured 2026-10-21 (2-core cloud machine): the food grid pays from about 128 pellets (100: 0.84x,
// 150: 1.22x, 300: 2.37x), the creature grid from about 64 creatures (40: 0.82x, 80: 1.10x, 300: 1.88x).
// Below that, checking everything is faster. Default worlds (60 food, 40 creatures) stay brute force.
export const SPATIAL = { on: true, foodFrom: 128, creaturesFrom: 64 };

// Square of (x, y). Positions are in [0, W) x [0, H), or up to W / H exactly with walls.
export function cellOf(x: number, y: number): number {
  let cx = Math.floor(x / CELL);
  let cy = Math.floor(y / CELL);
  if (cx >= GW) cx = GW - 1;
  else if (cx < 0) cx = 0;
  if (cy >= GH) cy = GH - 1;
  else if (cy < 0) cy = 0;
  return cy * GW + cx;
}

// The square at offset (ox, oy) from square home, or -1 when it is off the map (walls).
export function cellAt(home: number, ox: number, oy: number, walls: boolean): number {
  const hx = home % GW;
  let cx = hx + ox;
  let cy = (home - hx) / GW + oy;
  if (walls) {
    if (cx < 0 || cx >= GW || cy < 0 || cy >= GH) return -1;
  } else {
    cx = ((cx % GW) + GW) % GW;
    cy = ((cy % GH) + GH) % GH;
  }
  return cy * GW + cx;
}

export class Grid {
  readonly cells: number[][] = Array.from({ length: GW * GH }, () => []);
  private where: number[] = []; // square of each item
  readonly seen = new Int32Array(GW * GH); // visit stamps: with wrap-around, a big ring can repeat a square
  stamp = 0;

  build(items: readonly Point[]): void {
    for (let k = 0; k < this.cells.length; k++) this.cells[k].length = 0;
    this.where.length = items.length;
    for (let i = 0; i < items.length; i++) {
      const k = cellOf(items[i].x, items[i].y);
      this.where[i] = k;
      this.cells[k].push(i);
    }
  }

  // Item i moved to (x, y).
  move(i: number, x: number, y: number): void {
    const k = cellOf(x, y);
    const old = this.where[i];
    if (k === old) return;
    const list = this.cells[old];
    list.splice(list.indexOf(i), 1);
    this.cells[k].push(i);
    this.where[i] = k;
  }

  nextStamp(): number {
    if (++this.stamp === 0x7fffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }
}

// The nearest item to (x, y) that is not skipped, using the grid; same answer as nearest(..., 1, skip).
// After ring r, every square not yet searched is at least r * CELL away.
export function nearestOne<T extends Point>(
  grid: Grid, items: readonly T[], x: number, y: number, walls: boolean, skipItem: T | null, skipDead: boolean,
): Near<T> | undefined {
  const hit = { item: null as T | null, dx: 0, dy: 0, d2: 0 };
  return nearestOneInto(hit, grid, items, x, y, walls, skipItem, skipDead)
    ? { item: hit.item!, dx: hit.dx, dy: hit.dy, d2: hit.d2 }
    : undefined;
}

// A found item and its offset; reused by the every-tick searches so they make no garbage.
export interface Hit<T> {
  item: T | null;
  dx: number;
  dy: number;
  d2: number;
}

// nearestOne() writing into `hit`; false when nothing was found.
export function nearestOneInto<T extends Point>(
  hit: Hit<T>, grid: Grid, items: readonly T[], x: number, y: number, walls: boolean, skipItem: T | null, skipDead: boolean,
): boolean {
  let best = -1;
  let bdx = 0;
  let bdy = 0;
  let bd2 = Infinity;
  const halfW = W / 2;
  const halfH = H / 2;
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
        const item = items[j];
        if (item === skipItem || (skipDead && !(item as unknown as { alive: boolean }).alive)) continue;
        let dx = item.x - x;
        let dy = item.y - y;
        if (!walls) {
          if (dx > halfW) dx -= W;
          else if (dx < -halfW) dx += W;
          if (dy > halfH) dy -= H;
          else if (dy < -halfH) dy += H;
        }
        const d2 = dx * dx + dy * dy;
        if (d2 < bd2 || (d2 === bd2 && j < best)) {
          best = j;
          bdx = dx;
          bdy = dy;
          bd2 = d2;
        }
      }
    }
    if (best >= 0 && bd2 < r * r * CELL * CELL) break;
  }
  if (best < 0) return false;
  hit.item = items[best];
  hit.dx = bdx;
  hit.dy = bdy;
  hit.d2 = bd2;
  return true;
}

// The nearest item that is not skipped, checking every one (brute force), into `hit`: same answer as
// nearest(items, x, y, walls, 1, skip)[0], without the arrays and the skip function.
export function nearestBruteInto<T extends Point>(
  hit: Hit<T>, items: readonly T[], x: number, y: number, walls: boolean, skipItem: T | null, skipDead: boolean,
): boolean {
  let best = -1;
  let bdx = 0;
  let bdy = 0;
  let bd2 = 0;
  const halfW = W / 2;
  const halfH = H / 2;
  for (let j = 0; j < items.length; j++) {
    const item = items[j];
    if (item === skipItem || (skipDead && !(item as unknown as { alive: boolean }).alive)) continue;
    let dx = item.x - x;
    let dy = item.y - y;
    if (!walls) {
      if (dx > halfW) dx -= W;
      else if (dx < -halfW) dx += W;
      if (dy > halfH) dy -= H;
      else if (dy < -halfH) dy += H;
    }
    const d2 = dx * dx + dy * dy;
    if (best < 0 || d2 < bd2) {
      best = j;
      bdx = dx;
      bdy = dy;
      bd2 = d2;
    }
  }
  if (best < 0) return false;
  hit.item = items[best];
  hit.dx = bdx;
  hit.dy = bdy;
  hit.d2 = bd2;
  return true;
}

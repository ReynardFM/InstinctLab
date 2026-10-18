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

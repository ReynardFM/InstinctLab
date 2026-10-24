// Food that spreads like plants (rules.foodSpread, ecosystem mode only; Rey's idea 2026-10-23).
// Plants have roots: an eaten pellet regrows in the same spot after rules.regrow ticks. Each tick every
// pellet sprouts a new one of its kind within SPREAD_RANGE with chance rules.foodSpread, up to PLANT_CAP x
// rules.food good pellets and PLANT_CAP x the starting poison pellets: food left alone multiplies, and
// grazing can't wipe it out. (Without roots, an eaten pellet gone for good, prey ate the plants faster than
// they spread: 0 of 14 seeds lasted, README.) Poison spreads too (Rey's brief 2026-10-24) with its own cap,
// so it can't take over. If no pellet of a kind is left at all, one seeds itself somewhere at random.
// The world's random numbers (env) place the sprouts: same seed, same plants.
import type { World } from "./world.ts"; // types only, no import at run time
import { cos, sin } from "./dmath.ts";
import { inEcosystem } from "./mode.ts";
import { H, W } from "./space.ts";

export const SPREAD_RANGE = 25; // a sprout lands within this distance of its parent
export const PLANT_CAP = 3; // at most this many times rules.food good pellets (and the starting poison pellets)

export const spreading = (w: World) => w.rules.foodSpread > 0 && inEcosystem(w);

export function spreadFood(w: World): void {
  const r = w.rules;
  const food = w.food;
  const tick = w.tick;
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  // per kind (0 = good, 1 = poison): free slots (eaten for good), pellets, pellets standing now
  const free: number[][] = [[], []];
  const count = [0, 0];
  const active = [0, 0];
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    const k = f.poison ? 1 : 0;
    count[k]++;
    if (f.readyAt === Infinity) free[k].push(i);
    else if (f.readyAt <= tick) active[k]++;
  }
  const cap = [Math.round(r.food * PLANT_CAP), Math.round(Math.round(r.poison * r.food) * PLANT_CAP)];
  const n = food.length; // sprouts from this tick don't sprout again this tick (they appear next tick)
  for (let i = 0; i < n; i++) {
    const f = food[i];
    if (f.readyAt > tick) continue;
    if (w.env.next() >= r.foodSpread) continue;
    const k = f.poison ? 1 : 0;
    let slot = free[k].pop();
    if (slot === undefined) {
      if (count[k] >= cap[k]) continue;
      slot = food.length;
      food.push({ x: 0, y: 0, poison: f.poison, readyAt: 0 });
      count[k]++;
    }
    const a = w.env.next() * Math.PI * 2;
    const d = w.env.next() * SPREAD_RANGE;
    const s = food[slot];
    s.x = place(f.x + cos(a) * d, W);
    s.y = place(f.y + sin(a) * d, H);
    s.readyAt = tick + 1;
  }
  for (const k of [0, 1]) {
    if (active[k] > 0 || !free[k].length) continue;
    const s = food[free[k].pop()!];
    s.x = w.env.next() * W;
    s.y = w.env.next() * H;
    s.readyAt = tick + 1;
  }
}

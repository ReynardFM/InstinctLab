// Food that spreads like plants (rules.foodSpread, ecosystem mode only; Rey's idea 2026-10-23).
// Plants have roots: an eaten good pellet regrows in the same spot after rules.regrow ticks. Each tick every
// good pellet sprouts a new one within SPREAD_RANGE with chance rules.foodSpread, up to PLANT_CAP x
// rules.food good pellets: food left alone multiplies, and grazing can't wipe it out. (Without roots, an
// eaten pellet gone for good, prey ate the plants faster than they spread: 0 of 14 seeds lasted, README.)
// Poison doesn't spread (prey avoid it, so it would take over); it regrows somewhere new as before, so its
// share falls as the plants spread. If no good food is left at all, one pellet seeds itself at random.
// The world's random numbers (env) place the sprouts: same seed, same plants.
import type { World } from "./world.ts"; // types only, no import at run time
import { cos, sin } from "./dmath.ts";
import { inEcosystem } from "./mode.ts";
import { H, W } from "./space.ts";

export const SPREAD_RANGE = 25; // a sprout lands within this distance of its parent
export const PLANT_CAP = 3; // at most this many times rules.food good pellets

export const spreading = (w: World) => w.rules.foodSpread > 0 && inEcosystem(w);

export function spreadFood(w: World): void {
  const r = w.rules;
  const food = w.food;
  const tick = w.tick;
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  const free: number[] = []; // eaten good pellets: slots a sprout can take
  let good = 0;
  let active = 0;
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    if (f.poison) continue;
    good++;
    if (f.readyAt === Infinity) free.push(i);
    else if (f.readyAt <= tick) active++;
  }
  const cap = Math.round(r.food * PLANT_CAP);
  const n = food.length; // sprouts from this tick don't sprout again this tick (they appear next tick)
  for (let i = 0; i < n; i++) {
    const f = food[i];
    if (f.poison || f.readyAt > tick) continue;
    if (w.env.next() >= r.foodSpread) continue;
    let slot = free.pop();
    if (slot === undefined) {
      if (good >= cap) continue;
      slot = food.length;
      food.push({ x: 0, y: 0, poison: false, readyAt: 0 });
      good++;
    }
    const a = w.env.next() * Math.PI * 2;
    const d = w.env.next() * SPREAD_RANGE;
    const s = food[slot];
    s.x = place(f.x + cos(a) * d, W);
    s.y = place(f.y + sin(a) * d, H);
    s.readyAt = tick + 1;
  }
  if (active === 0 && free.length) {
    const s = food[free.pop()!];
    s.x = w.env.next() * W;
    s.y = w.env.next() * H;
    s.readyAt = tick + 1;
  }
}

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

// Seasons (rules.season = ticks in a year, Rey 2026-11-09: "rotate more poison or more normal food"). The year has two halves: a clean
// season, then a poison season. seasonFactor is what the poison plants are multiplied by: 1 - SEASON_SWING (clean), 1 + SEASON_SWING
// (poison), so the year's average is the usual amount. At each turn of the season, plants picked at random change kind where they
// stand until the poison share fits the new season; the number of plants stays the same. Off (0): factor 1, nothing is drawn.
export const SEASON_SWING = 2 / 3;
export const seasonFactor = (w: World): number => {
  const year = w.rules.season;
  if (!(year > 0)) return 1;
  return Math.floor((2 * w.tick) / year) % 2 === 0 ? 1 - SEASON_SWING : 1 + SEASON_SWING;
};
function turnSeason(w: World): void {
  const r = w.rules;
  const plants = w.food.filter((f) => !f.remains);
  // rules.poison is the poison share of all plants on a fresh map (creature.ts newFoodLayout); the season scales it
  const want = Math.min(plants.length, Math.round(plants.length * r.poison * seasonFactor(w))); // poison plants this season
  const have = plants.filter((f) => f.poison).length;
  const toPoison = have < want; // too few poison plants: good ones turn; too many: poison ones turn back
  const from = plants.filter((f) => f.poison !== toPoison);
  let n = Math.min(Math.abs(want - have), from.length);
  for (let i = 0; n > 0; i++, n--) {
    const j = i + Math.floor(w.env.next() * (from.length - i)); // pick without repeats
    [from[i], from[j]] = [from[j], from[i]];
    from[i].poison = toPoison;
  }
}

export function spreadFood(w: World): void {
  const r = w.rules;
  const food = w.food;
  const tick = w.tick;
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  if (r.season > 0 && tick % Math.max(1, Math.floor(r.season / 2)) === 0) turnSeason(w); // rules.season: the plants turn with the season
  // per kind (0 = good, 1 = poison): free slots (eaten for good), pellets, pellets standing now
  const free: number[][] = [[], []];
  const count = [0, 0];
  const active = [0, 0];
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    if (f.remains) continue; // remains are not plants: they don't sprout or count
    const k = f.poison ? 1 : 0;
    count[k]++;
    if (f.readyAt === Infinity) free[k].push(i);
    else if (f.readyAt <= tick) active[k]++;
  }
  // rules.season: the poison cap follows the season and the good cap gives way, so the total cap is unchanged (factor 1 = as before)
  const poisonCap = Math.round(Math.round(r.poison * r.food) * PLANT_CAP * seasonFactor(w));
  const cap = [Math.round(r.food * PLANT_CAP) - (poisonCap - Math.round(Math.round(r.poison * r.food) * PLANT_CAP)), poisonCap];
  const n = food.length; // sprouts from this tick don't sprout again this tick (they appear next tick)
  for (let i = 0; i < n; i++) {
    const f = food[i];
    if (f.readyAt > tick || f.remains) continue;
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

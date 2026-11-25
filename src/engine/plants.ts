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

// Seasons (rules.season = ticks in a year; Rey 2026-11-09). The year has four quarters:
//   0 foraging        plants all over the map, no poison plants
//   1 poison foraging plants all over the map, twice the usual poison plants
//   2 farm            plants packed into the farm zones, no poison plants
//   3 poison farm     plants packed into the farm zones, twice the usual poison plants
// seasonFactor is what the poison plants are multiplied by (1 - SEASON_SWING clean, 1 + SEASON_SWING poison), so the year's average is
// the usual amount. At each turn, plants picked at random change kind where they stand until the poison share fits; when the layout
// changes (foraging <-> farm) every plant moves to a random spot of the new layout. The number of plants stays the same.
// Farms: FARMS discs of radius FARM_R, placed by the world's own random numbers the first time they are needed (w.eco.farms).
// Off (0): factor 1, nothing moves, nothing is drawn.
export const SEASON_SWING = 1; // extreme (Rey 2026-11-09): no poison plants in the clean seasons, double in the poison seasons
export const FARMS = 2, FARM_R = 110;
// rules.seasonFarm = the number of farms; their total area stays that of the 2 built farms, so more farms are smaller (8 farms: radius 55)
export const farmRadius = (n: number): number => FARM_R * Math.sqrt(FARMS / n);
export const SEASON_NAMES = ["foraging", "poison foraging", "farm", "poison farm"];
export const seasonQuarter = (w: World): number => (w.rules.season > 0 ? Math.floor((4 * w.tick) / w.rules.season) % 4 : -1);
export const seasonFactor = (w: World): number => {
  const q = seasonQuarter(w);
  return q < 0 ? 1 : q % 2 === 0 ? 1 - SEASON_SWING : 1 + SEASON_SWING;
};
// Poison ramp (rules.poisonRamp / poisonPeak, Rey 2026-11-13: "start normal, transition slowly to a fully poisoned environment, then
// hold"). The share of POISON PLANTS AMONG ALL PLANTS rises in a straight line from the normal world's own share at tick 0 to
// rules.poisonPeak at tick poisonRamp, then stays there. The normal world's share is set by the caps, not by rules.poison: poison plants
// are capped at PLANT_CAP x round(poison x food) and good ones at PLANT_CAP x food, so poison 0.3 / food 60 gives 54 of 234 = 0.23.
// (FIX 2026-11-13: the first version re-typed plants to rules.poison of all plants = 0.30 at tick 0, a jump from 0.23, and the live
// poison share ran ~0.40 against ~0.27 in the steady world; its first results did not start "normal".)
// FIX 2026-11-24 (Rey: "a"; the flat-ramp control showed the old machinery costs hunters: die-outs 5.5 vs 2.3, hunters ~13 vs ~21):
// the ramp no longer re-types plants. It moves only the two caps (their total stays the same); poison plants grow into the new room by
// spreading from their own patches, and an eaten plant whose kind is over its cap dies instead of regrowing (life.ts, overCap), so the
// other kind shrinks only where it is eaten. A ramp held at the normal share is the plain world exactly. The old version (random plants
// re-typed every 1,000 ticks, poison scattered instead of patched) is in git 8f8da49 and before. With rules.season the ramp swings (rampShare).
export const rampCaps = (w: World): [number, number] => { const [g, p] = baseCaps(w), pc = Math.round((g + p) * rampShare(w)); return [g + p - pc, pc]; };
// rules.poisonRamp: is the kind of this plant above its cap? Counts the living plants (eaten ones regrowing count; dead slots don't).
export function overCap(w: World, poison: boolean): boolean {
  if (!(w.rules.poisonRamp > 0)) return false;
  let n = 0;
  for (const f of w.food) if (!f.remains && f.poison === poison && f.readyAt !== Infinity) n++;
  return n > rampCaps(w)[poison ? 1 : 0];
}
const baseCaps = (w: World): [number, number] => [Math.round(w.rules.food * PLANT_CAP), Math.round(Math.round(w.rules.poison * w.rules.food) * PLANT_CAP)];
export const baseShare = (w: World): number => { const [g, p] = baseCaps(w); return p / Math.max(1, g + p); };
// rules.season + poisonRamp (Rey 2026-11-24: "4 phases: ori, poison, back to ori, back to poison"; no new setting): the ramp follows the
// season's quarters instead of climbing once. Quarters 0, 2 = the normal share, 1, 3 = poisonPeak. At each quarter start the share moves
// in a straight line over poisonRamp ticks (1 = at once; then poison grows or dies back at its own speed, as in the fixed ramp). With a
// ramp the season does not re-type plants or draw farms (spreadFood); seasons without a ramp are unchanged.
export const rampShare = (w: World): number => {
  const r = w.rules, b = baseShare(w);
  if (r.season > 0) {
    const k = Math.floor((4 * w.tick) / r.season), into = w.tick - (k * r.season) / 4;
    const to = k % 2 ? r.poisonPeak : b, from = k % 2 || k === 0 ? b : r.poisonPeak;
    return from + (to - from) * Math.min(1, into / Math.max(1, r.poisonRamp));
  }
  return b + (r.poisonPeak - b) * Math.min(1, w.tick / Math.max(1, r.poisonRamp));
};
export const farmSeason = (w: World): boolean => w.rules.seasonFarm > 0 && seasonQuarter(w) >= 2;
function turnSeason(w: World): void {
  const r = w.rules;
  const plants = w.food.filter((f) => !f.remains);
  // rules.poison is the poison share of all plants on a fresh map (creature.ts newFoodLayout); the season scales it
  // poison plants this season
  const want = Math.min(plants.length, Math.round(plants.length * r.poison * seasonFactor(w)));
  const have = plants.filter((f) => f.poison).length;
  const toPoison = have < want; // too few poison plants: good ones turn; too many: poison ones turn back
  const from = plants.filter((f) => f.poison !== toPoison);
  let n = Math.min(Math.abs(want - have), from.length);
  for (let i = 0; n > 0; i++, n--) {
    const j = i + Math.floor(w.env.next() * (from.length - i)); // pick without repeats
    [from[i], from[j]] = [from[j], from[i]];
    from[i].poison = toPoison;
  }
  // the layout: quarter 2 packs every plant into the farms, quarter 0 spreads them over the map again (not at the very start: the fresh map is spread already)
  const q = seasonQuarter(w);
  if (r.seasonFarm > 0 && (q === 2 || (q === 0 && w.tick > 0))) { // rules.seasonFarm 0: no farm seasons, the plants stay spread
    const walls = r.walls > 0;
    const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
    const farms = w.eco.farms;
    const nFarms = Math.max(1, Math.round(r.seasonFarm)), farmR = farmRadius(nFarms); // rules.seasonFarm: how many farms (2 = as built)
    if (q === 2 && !farms.length) for (let k = 0; k < nFarms; k++) farms.push(w.env.next() * W, w.env.next() * H);
    for (const f of plants) {
      if (q === 0) { f.x = w.env.next() * W; f.y = w.env.next() * H; continue; }
      const k = Math.floor(w.env.next() * nFarms), a = w.env.next() * Math.PI * 2, d = farmR * Math.sqrt(w.env.next()); // even over the disc
      f.x = place(farms[2 * k] + cos(a) * d, W);
      f.y = place(farms[2 * k + 1] + sin(a) * d, H);
    }
  }
}

// rules.rampFarm (Rey 2026-11-24, "A": the four seasons on the fixed ramp: spread-normal, spread-poison, farm-normal, farm-poison).
// With season + poisonRamp + rampFarm, quarters 2-3 are FARM seasons: at the start of quarter 2 every plant moves into rules.seasonFarm
// farm discs (total area as the 2 built farms). Poison keeps its own patch: in each farm the poison plants fill one slice of the disc
// (slice size = their share), the clean plants the rest, so poison is not mixed in at random (the old ramp's flaw). During farm seasons a
// sprout that lands outside every farm does not take root (a fence), so farms do not leak over 750k ticks. At the start of quarter 0 of a
// later year the plants scatter over the map again. Off (0): nothing here runs; the swing alone is unchanged.
const farmOn = (w: World): boolean => w.rules.rampFarm > 0 && w.rules.season > 0 && w.rules.poisonRamp > 0;
function moveFarm(w: World): void {
  const r = w.rules, q = seasonQuarter(w);
  const plants = w.food.filter((f) => !f.remains);
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  if (q === 0) { if (w.tick > 0) for (const f of plants) { f.x = w.env.next() * W; f.y = w.env.next() * H; } return; }
  if (q !== 2) return;
  const farms = w.eco.farms, nFarms = Math.max(1, Math.round(r.seasonFarm)), farmR = farmRadius(nFarms);
  if (!farms.length) for (let k = 0; k < nFarms; k++) farms.push(w.env.next() * W, w.env.next() * H);
  const start: number[] = []; for (let k = 0; k < nFarms; k++) start.push(w.env.next() * Math.PI * 2); // where each farm's poison slice begins
  const share = plants.filter((f) => f.poison).length / Math.max(1, plants.length);
  for (const f of plants) {
    const k = Math.floor(w.env.next() * nFarms), u = w.env.next(), d = farmR * Math.sqrt(w.env.next());
    const a = start[k] + (f.poison ? u * share : share + u * (1 - share)) * Math.PI * 2;
    f.x = place(farms[2 * k] + cos(a) * d, W);
    f.y = place(farms[2 * k + 1] + sin(a) * d, H);
  }
}
// rules.rampFarm: is (x, y) inside a farm? (wrapping distance unless walls)
function inFarm(w: World, x: number, y: number): boolean {
  const farms = w.eco.farms, R = farmRadius(Math.max(1, Math.round(w.rules.seasonFarm))), walls = w.rules.walls > 0;
  for (let k = 0; k < farms.length; k += 2) {
    let dx = Math.abs(x - farms[k]), dy = Math.abs(y - farms[k + 1]);
    if (!walls) { dx = Math.min(dx, W - dx); dy = Math.min(dy, H - dy); }
    if (dx * dx + dy * dy <= R * R) return true;
  }
  return false;
}
export function spreadFood(w: World): void {
  const r = w.rules;
  const food = w.food;
  const tick = w.tick;
  const walls = r.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  if (r.season > 0 && !(r.poisonRamp > 0) && tick % Math.max(1, Math.floor(r.season / 4)) === 0) turnSeason(w); // rules.season: the plants turn with the season (not with a ramp: the ramp moves the caps, rampShare)
  if (farmOn(w) && tick % Math.max(1, Math.floor(r.season / 4)) === 0) moveFarm(w); // rules.rampFarm: farms in quarters 2-3
  const fence = farmOn(w) && seasonQuarter(w) >= 2 && w.eco.farms.length > 0; // rules.rampFarm: sprouts outside the farms die
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
  let poisonCap = Math.round(Math.round(r.poison * r.food) * PLANT_CAP * seasonFactor(w));
  let cap = [Math.round(r.food * PLANT_CAP) - (poisonCap - Math.round(Math.round(r.poison * r.food) * PLANT_CAP)), poisonCap];
  const ramp = r.poisonRamp > 0;
  if (ramp) { cap = rampCaps(w); poisonCap = cap[1]; } // the ramp moves the caps
  const n = food.length; // sprouts from this tick don't sprout again this tick (they appear next tick)
  for (let i = 0; i < n; i++) {
    const f = food[i];
    if (f.readyAt > tick || f.remains) continue;
    if (w.env.next() >= r.foodSpread) continue;
    const k = f.poison ? 1 : 0;
    if (ramp && count[k] - free[k].length >= cap[k]) continue; // rules.poisonRamp: no room for this kind (dead slots don't count)
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
    if (fence && !inFarm(w, s.x, s.y)) { s.readyAt = Infinity; free[k].push(slot); continue; } // rules.rampFarm: outside the fence
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

// Ecosystem mode: no generations. Creatures live, eat, have children when they are full, age and die,
// and the population rises and falls with the food. Same seed + same rules = same run, as always.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature } from "./creature.ts";
import { genomeSize, type Genome } from "./brain.ts";
import { newCreature } from "./creature.ts";
import { mutate } from "./breed.ts";
import { maybeSplit, newFamily, retire } from "./lineage.ts";
import { inputCount } from "./senses.ts";
import { live } from "./life.ts";
import { H, W, offset } from "./space.ts";

export const ECO_SAMPLE = 100; // ticks between population samples (popHist, ageHist)
export const RESCUE = 40; // fresh random founders put in when everyone has died (same as the starting population)
export const MAX_POP = 1000; // safety limit for memory and speed, not a game rule: births pause above it
export const PAIR_RANGE = 30; // two ready creatures this close can have a child together
const KEEP_DEATHS = 200;

export function stepEcosystem(w: World): void {
  const { rules } = w;
  const scale = rules.ageScale;
  for (const c of w.creatures) {
    if (!c.alive) continue;
    live(w, c, scale > 0 ? 1 + c.age / scale : 1); // ageing: at age `scale` living costs double
    c.age++;
  }

  // births: children are added after everyone has moved, and act from the next tick
  const born: Creature[] = [];
  const room = () => w.creatures.length + born.length < MAX_POP;
  const ready = (c: Creature) => c.alive && c.energy >= rules.birthEnergy;
  if (rules.birth === 1) {
    // two parents: a ready creature pairs with the nearest ready creature within PAIR_RANGE
    const walls = rules.walls > 0;
    const used = new Set<Creature>();
    for (const a of w.creatures) {
      if (!room()) break;
      if (used.has(a) || !ready(a)) continue;
      let partner: Creature | null = null;
      let best = PAIR_RANGE * PAIR_RANGE;
      for (const b of w.creatures) {
        if (b === a || used.has(b) || !ready(b)) continue;
        const dx = offset(b.x - a.x, W, walls);
        const dy = offset(b.y - a.y, H, walls);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          partner = b;
        }
      }
      if (!partner) continue;
      used.add(a);
      used.add(partner);
      const p = partner;
      const mixed = a.g.map((x, k) => (w.rng.next() < 0.5 ? x : p.g[k])); // each weight from one parent
      const fromA = a.energy / 3; // each parent gives a third of its energy
      const fromB = p.energy / 3;
      a.energy -= fromA;
      p.energy -= fromB;
      p.children++;
      born.push(makeChild(w, a, mutate(w, mixed, rules.mutation), fromA + fromB));
    }
  } else {
    // splitting: a ready creature gives half its energy to a child with a mutated copy of its brain
    for (const a of w.creatures) {
      if (!room()) break;
      if (!ready(a)) continue;
      const half = a.energy / 2;
      a.energy -= half;
      born.push(makeChild(w, a, mutate(w, a.g, rules.mutation), half));
    }
  }

  // deaths: the starved leave; old age is why if they were past ageScale
  const alive: Creature[] = [];
  for (const c of w.creatures) {
    if (c.alive) {
      alive.push(c);
      continue;
    }
    w.eco.deaths++;
    if (scale > 0 && c.age >= scale) w.eco.oldAge++;
    w.eco.recentDeaths.push({ x: c.x, y: c.y, tick: w.tick });
  }
  if (w.eco.recentDeaths.length > KEEP_DEATHS) w.eco.recentDeaths.splice(0, w.eco.recentDeaths.length - KEEP_DEATHS);
  w.creatures = alive.concat(born);

  if (w.creatures.length === 0) rescue(w);

  // families with no members left move to the legacy record (stamped with the tick)
  const present = new Set(w.creatures.map((c) => c.family));
  for (const fam of [...w.families.values()]) if (!present.has(fam.id)) retire(w, fam, w.tick);

  w.tick++;
  if (w.tick % ECO_SAMPLE === 0) sample(w);
}

function makeChild(w: World, parent: Creature, genome: Genome, energy: number): Creature {
  const child = newCreature(w, genome, parent.family, false, parent.hue);
  const walls = w.rules.walls > 0;
  const place = (v: number, size: number) => (walls ? Math.min(Math.max(v, 0), size) : (v + size) % size);
  child.x = place(parent.x + (w.env.next() - 0.5) * 10, W); // born next to the parent
  child.y = place(parent.y + (w.env.next() - 0.5) * 10, H);
  child.energy = energy;
  child.depth = parent.depth + 1;
  parent.children++;
  maybeSplit(w, child, true); // no branch trials here: there are no generations to judge them in
  w.eco.births++;
  return child;
}

// Everyone died: RESCUE fresh random founders, each starting its own family.
function rescue(w: World): void {
  const { rules } = w;
  for (let i = 0; i < RESCUE; i++) {
    const genome = Array.from({ length: genomeSize(inputCount(rules), rules.hidden) }, () => w.rng.gauss() * 0.5);
    const id = w.nextFamilyId++;
    w.families.set(id, newFamily(id, genome, null, w.tick));
    w.creatures.push(newCreature(w, genome, id, false, null));
  }
  w.eco.rescues++;
}

function sample(w: World): void {
  const n = w.creatures.length;
  w.eco.popHist.push(n);
  w.eco.ageHist.push(n ? w.creatures.reduce((s, c) => s + c.age, 0) / n : 0);
  const sizes = new Map<number, number>();
  for (const c of w.creatures) sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
  for (const [id, size] of sizes) {
    const fam = w.families.get(id);
    if (fam && size > fam.peakSize) fam.peakSize = size;
  }
}

// Lineage bookkeeping: families, branches on trial, champions, newcomers and the legacy record.
// Only newcomers (and their protection) change who breeds; everything else is labels and history.
import type { World } from "./world.ts"; // types only, no import at run time
import type { Genome } from "./brain.ts";
import { founderHue, newCreature, type Creature } from "./creature.ts";
import { inherited, mutate } from "./breed.ts";
import { inEcosystem } from "./mode.ts";

// Most recent extinct families kept in the legacy record.
export const LEGACY_LIMIT = 500;

export interface Family {
  id: number;
  ref: Genome; // the family's main brain: splits are measured against it
  founderRef: Genome; // the brain the family started from (never changes)
  champions: { generation: number; genome: Genome }[]; // every time a champion replaced the main brain
  parent: number | null; // family it split from; null for the original founders
  bornGeneration: number;
  diedGeneration: number | null; // last generation with living members; null while still alive
  peakSize: number; // most members in any one generation
  bestEaten: number; // most food any member ate in one generation, per layout
  avgHist: number[]; // members' average food per layout, one entry per generation it had members
  newcomer: boolean; // started as a newcomer (a hard-mutated copy of a parent from family `parent`)
  protectedUntil: number; // its seats are guaranteed in generations before this one; 0 = never protected
  bornInTicks: boolean; // ecosystem mode: bornGeneration is a tick, not a generation
  diedInTicks: boolean; // the same for diedGeneration
}


// A group of creatures whose brains drifted far from their family's main brain, on trial.
// They stay in their family until they out-eat the rest of it rules.splitProof generations in a row.
export interface Branch {
  id: number;
  family: number; // the family it may split from
  ref: Genome; // brain of the child that started it; later drifters within splitDistance of it join
  bornGeneration: number;
  wins: number; // generations in a row it out-ate the rest of its family
}


// After the next generation is in place: proven branches become families, empty branches failed their
// trial, and families with no members left move to the legacy record.
export function settleLineage(w: World, proven: Branch[]): void {
  for (const b of proven) promote(w, b);
  const inBranch = new Set(w.creatures.map((c) => c.branch));
  for (const id of [...w.branches.keys()]) {
    if (!inBranch.has(id)) {
      w.branches.delete(id);
      w.failedBranches++;
    }
  }
  const alive = new Set(w.creatures.map((c) => c.family));
  for (const fam of [...w.families.values()]) if (!alive.has(fam.id)) retire(w, fam, w.generation);
}

// Speciation: a child that has drifted far enough from its family's main brain starts a branch on trial
// (or, with splitProof 0, a new family at once). Pure bookkeeping: families and branches never affect
// who breeds, so evolution plays out the same either way.
export function maybeSplit(w: World, child: Creature, instant = false): void {
  const limit = w.rules.splitDistance;
  if (child.branch !== null) return; // already on trial: its brain is judged by the branch's results
  const fam = w.families.get(child.family);
  if (!limit || !fam || brainDistance(child.g, fam.ref) <= limit) return;
  // a relative may already have split off from this family: join it instead of founding a near-duplicate
  for (const f of w.families.values()) {
    if (f.parent === child.family && brainDistance(child.g, f.ref) <= limit) {
      child.family = f.id;
      child.hue = founderHue(f.id);
      return;
    }
  }
  if (w.rules.splitProof > 0 && !instant) {
    for (const b of w.branches.values()) {
      if (b.family === child.family && brainDistance(child.g, b.ref) <= limit) {
        child.branch = b.id;
        return;
      }
    }
    const id = w.nextBranchId++;
    w.branches.set(id, { id, family: child.family, ref: child.g.slice(), bornGeneration: w.generation + 1, wins: 0 });
    child.branch = id;
    return;
  }
  const id = w.nextFamilyId++;
  // ecosystem mode has no generations: families are stamped with the tick instead
  const eco = inEcosystem(w);
  w.families.set(id, newFamily(id, child.g, child.family, eco ? w.tick : w.generation + 1, eco));
  child.family = id;
  child.hue = founderHue(id);
  w.splits++;
}

// After each generation: did each branch out-eat the rest of its family (average food)?
// A branch whose family has no other members left wins by default: it outlived the old line.
// Returns the branches that have now won rules.splitProof generations in a row.
export function judgeBranches(w: World, ranked: Creature[]): Branch[] {
  const proven: Branch[] = [];
  for (const b of w.branches.values()) {
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (const c of ranked) {
      if (c.branch === b.id) {
        inSum += c.eaten;
        inN++;
      } else if (c.family === b.family) {
        outSum += c.eaten;
        outN++;
      }
    }
    if (inN === 0) continue; // born this generation: nothing to judge yet
    const won = outN === 0 || inSum / inN > outSum / outN;
    b.wins = won ? b.wins + 1 : 0;
    if (b.wins >= w.rules.splitProof) proven.push(b);
  }
  return proven;
}

// A proven branch becomes a family of its own.
export function promote(w: World, b: Branch): void {
  w.branches.delete(b.id);
  const id = w.nextFamilyId++;
  w.families.set(id, newFamily(id, b.ref, b.family, w.generation + 1));
  w.splits++;
  for (const c of w.creatures) {
    if (c.branch === b.id) {
      c.branch = null;
      c.family = id;
      c.hue = founderHue(id);
    }
  }
}

export function newFamily(id: number, genome: Genome, parent: number | null, bornGeneration: number, bornInTicks = false): Family {
  return {
    id, ref: genome.slice(), founderRef: genome.slice(), champions: [], parent, bornGeneration,
    diedGeneration: null, peakSize: 0, bestEaten: 0, avgHist: [], newcomer: false, protectedUntil: 0,
    bornInTicks, diedInTicks: false,
  };
}

// A newcomer: a good parent's brain mutated very hard, starting a family of its own. It is far from
// everything, so it would almost always lose straight away; protection gives it time to improve.
export function addNewcomer(w: World, ranked: Creature[], next: Creature[], parents: number): void {
  const { rules, rng } = w;
  const p = ranked[Math.floor(rng.next() * parents)];
  const genome = inherited(w, p).map((x) => x + rng.gauss() * rules.newcomerMutation);
  const id = w.nextFamilyId++;
  const born = w.generation + 1;
  const fam = newFamily(id, genome, p.family, born);
  fam.newcomer = true;
  fam.protectedUntil = born + rules.protectGens;
  w.families.set(id, fam);
  w.newcomerCount++;
  next.push(newCreature(w, genome, id, false, null));
}

// While protected, a newcomer family's best member keeps its seat and has one child, whatever its rank:
// a tiny evolution of its own. If that member is already an elite, only the child is added.
export function protectNewcomers(w: World, ranked: Creature[], next: Creature[], elite: number): void {
  const { rules } = w;
  for (const fam of w.families.values()) {
    if (!fam.newcomer || w.generation >= fam.protectedUntil) continue;
    const i = ranked.findIndex((c) => c.family === fam.id);
    if (i < 0) continue;
    const best = ranked[i];
    if (i >= elite && next.length < rules.pop) {
      const keep = newCreature(w, inherited(w, best).slice(), fam.id, true, best.hue);
      keep.elite = false; // not one of the overall best: it keeps its seat only because it is protected
      keep.branch = best.branch;
      next.push(keep);
    }
    if (next.length < rules.pop) {
      const child = newCreature(w, mutate(w, inherited(w, best), rules.mutation), fam.id, false, best.hue);
      child.branch = best.branch;
      maybeSplit(w, child);
      next.push(child);
    }
  }
}

// Size, best and average score of each family in the generation that just finished (branch members count
// for their family).
export function recordFamilyStats(w: World, ranked: Creature[], per: number): void {
  const sizes = new Map<number, number>();
  const sums = new Map<number, number>();
  for (const c of ranked) {
    sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
    sums.set(c.family, (sums.get(c.family) ?? 0) + c.eaten);
    const fam = w.families.get(c.family);
    if (fam && c.eaten / per > fam.bestEaten) fam.bestEaten = c.eaten / per;
  }
  for (const [id, n] of sizes) {
    const fam = w.families.get(id);
    if (!fam) continue;
    if (n > fam.peakSize) fam.peakSize = n;
    fam.avgHist.push(sums.get(id)! / n / per);
  }
}

// An elite that has stayed on top for rules.championStreak generations becomes its family's main brain,
// and splits are measured against it from then on. Elites arrive best-first, so only the family's
// highest-ranked elite can be crowned. Measured: with default rules a streak of 5 never happened in
// 500 generations (scores are mostly luck), 3 happens about 1-2 times per 100 generations.
export function crownChampions(w: World, elites: Creature[]): void {
  if (!w.rules.championStreak) return;
  const seen = new Set<number>();
  for (const c of elites) {
    if (c.branch !== null || seen.has(c.family)) continue; // a branch on trial can't crown its family's brain
    seen.add(c.family);
    const fam = w.families.get(c.family);
    if (fam && c.streak === w.rules.championStreak) {
      fam.ref = c.g.slice();
      fam.champions.push({ generation: w.generation + 1, genome: c.g.slice() });
    }
  }
}

// Moves an extinct family into the legacy record, keeping only the most recent LEGACY_LIMIT.
export function retire(w: World, fam: Family, lastGeneration: number): void {
  fam.diedGeneration = lastGeneration;
  fam.diedInTicks = inEcosystem(w);
  w.families.delete(fam.id);
  w.legacy.push(fam);
  if (w.legacy.length > LEGACY_LIMIT) w.legacy.splice(0, w.legacy.length - LEGACY_LIMIT);
}

// Root-mean-square difference per weight. 0 = identical brains.
export function brainDistance(a: Genome, b: Genome): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d; // not ** : its rounding is up to each engine
  }
  return Math.sqrt(s / a.length);
}

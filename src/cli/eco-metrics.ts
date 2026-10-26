// The numbers npm run eco-lab reports for one ecosystem run with hunters, as plain functions of the run's result
// (so they can be tested and used by other scripts). Pure: no world, no randomness.
import type { EcoResult } from "./job.ts";

export const DONE_ROUND = 20000; // Rey's brief: done = a round of this many ticks with both sides alive
export const KILL_ROUND = 5000; // kill if a seed never gets a round past this

// Rise-and-fall cycles in a population series (one sample every 100 ticks): smoothed over 10 samples, a cycle
// is the count going from below its own average to 15% above it (and back below 85% before the next one counts).
export function cycles(series: number[]): number {
  if (!series.length) return 0;
  const s = series.map((_, i) => {
    const w = series.slice(Math.max(0, i - 5), i + 5);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  let above = s[0] > mean;
  let ups = 0;
  for (const v of s) {
    if (!above && v > mean * 1.15) {
      above = true;
      ups++;
    } else if (above && v < mean * 0.85) above = false;
  }
  return ups;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export interface DefenceSummary {
  win: { nearEat: number; farEat: number; nearTicks: number; farTicks: number }[]; // per MEASURE_WINDOW ticks
  famTop: number; // poison per 1000 member-ticks: the biggest quarter of the families (by member-ticks)
  famRest: number; // the rest
}

// Families of one run, biggest quarter vs the rest (families with at least minTicks member-ticks).
export function familySplit(fams: { eat: number; ticks: number }[], minTicks = 5000): { top: number; rest: number } {
  const big = fams.filter((f) => f.ticks >= minTicks).sort((a, b) => b.ticks - a.ticks);
  if (big.length < 4) return { top: NaN, rest: NaN };
  const q = Math.ceil(big.length / 4);
  const rate = (f: { eat: number; ticks: number }) => (1000 * f.eat) / f.ticks;
  return { top: avg(big.slice(0, q).map(rate)), rest: avg(big.slice(q).map(rate)) };
}

export interface EcoMetrics {
  pass: boolean; // a round of DONE_ROUND ticks with both sides alive (rounds still running count)
  killed: boolean; // never a round past KILL_ROUND
  preyCycles: number;
  hunterCycles: number;
  bothCycle: boolean; // both sides 2+ cycles
  hunterDieOuts: number;
  preyDieOuts: number;
  prey: number; // average alive
  hunters: number;
  poison: number; // poison pellets eaten per prey per 1000 ticks
  sick: number; // share of prey that are sick (poison level above SICK), averaged over samples
  pick: number; // sick share of catches / sick share of prey (1 = hunters eat anything; below 1 = prefer fresh)
  nearFarFirst: number; // poison eaten per prey-tick with a hunter near / with none, first window (eco-lab measures)
  nearFarLast: number; // the same, last window (a defence would push this above 1)
  famTop: number; // poison per 1000 member-ticks, biggest quarter of families vs the rest
  famRest: number;
}

export function ecoMetrics(e: EcoResult): EcoMetrics {
  const rounds = e.rounds ?? [];
  const lens = [...rounds.map((r) => r.end - r.start), (e.ticks ?? 0) - (e.roundStart ?? 0)];
  const longest = Math.max(...lens);
  const hp = e.hunterPopHist ?? [];
  const s = e.sick;
  const share = s && s.samples ? s.sickShare / s.samples : NaN;
  const caughtSick = s && s.caught ? s.caughtSick / s.caught : NaN;
  const nf = (w?: DefenceSummary["win"][number]) =>
    w && w.nearTicks && w.farTicks && w.farEat ? (w.nearEat / w.nearTicks) / (w.farEat / w.farTicks) : NaN;
  const d = e.defence;
  const preyCycles = cycles(e.popHist);
  const hunterCycles = cycles(hp);
  return {
    pass: longest >= DONE_ROUND,
    killed: longest < KILL_ROUND,
    preyCycles,
    hunterCycles,
    bothCycle: preyCycles >= 2 && hunterCycles >= 2,
    hunterDieOuts: rounds.filter((r) => r.died !== "prey").length,
    preyDieOuts: rounds.filter((r) => r.died !== "hunters").length,
    prey: avg(e.popHist),
    hunters: avg(hp),
    poison: s && e.ticks ? (1000 * s.poisonEaten) / avg(e.popHist) / e.ticks : NaN,
    sick: share,
    pick: share > 0 ? caughtSick / share : NaN,
    nearFarFirst: nf(d?.win[0]),
    nearFarLast: nf(d?.win.at(-1)),
    famTop: d?.famTop ?? NaN,
    famRest: d?.famRest ?? NaN,
  };
}

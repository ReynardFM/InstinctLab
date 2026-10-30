// One roguelite run: the same species through the stages, a fixed generation budget per stage.
// Used by the worker and by the page fallback alike, so both give identical results.
import { Evolver, SPECIES, DEFAULT_SETTINGS, EVERY, type Level, type Sense, type Stats, type Weights } from "./sim.ts";

export const BUDGET = 60; // generations per stage (tuned: proto/tune-run.ts, proto/tune-species.ts)
export const SCORE_CHECKS = 4; // stage score = average of the last 4 checks (no lucky single check)
export const STAGES: Level[] = [
  { id: "S1", name: "Meadow", good: 40, bad: 0, hunters: 0, menu: ["energy"], blurb: "Only food. Learn to find it." },
  { id: "S2", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"], blurb: "20 of the 50 beads are poison." },
  { id: "S3", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"], blurb: "Six hunters roam; a caught creature is out for the round." },
];

export interface StageStart { type: "stage"; run: number; stage: number; sp: number; seed: number; layers: number[]; build: Sense[]; weights: Weights }
export interface Stop { type: "stop" }
export interface Check { type: "check"; run: number; stage: number; gen: number; progress: number; champ: number[]; champStats: Stats; ruleStats: Stats; msPerGen: number }
export interface Done { type: "done"; run: number; stage: number; score: number; hist: number[] }
export type Out = Check | Done;

export const stageScore = (hist: number[]) => { const w = hist.slice(-SCORE_CHECKS); return w.reduce((s, x) => s + x, 0) / w.length; };

export class Runner {
  private ev: Evolver | null = null;
  private run = -1;

  // Generator for one stage: yields often (page slicing), emits checks and the final result through `out`.
  *stage(m: StageStart, out: (o: Out) => void): Generator<void, void> {
    if (m.stage === 0 || !this.ev || this.run !== m.run) {
      this.ev = new Evolver(STAGES[m.stage], m.build, m.layers, m.seed, { ...DEFAULT_SETTINGS, weights: m.weights }, SPECIES[m.sp]);
      this.run = m.run;
    } else {
      this.ev.nextStage(STAGES[m.stage], m.build);
      this.ev.set = { ...this.ev.set, weights: m.weights };
    }
    const ev = this.ev, from = ev.hist.length, end = ev.gen + BUDGET;
    let t0 = performance.now(), gens = 0;
    while (ev.gen < end) {
      const it = ev.generation();
      let r = it.next();
      while (!r.done) { yield; r = it.next(); }
      gens++;
      if (r.value !== null) {
        out({ type: "check", run: m.run, stage: m.stage, gen: ev.gen - (end - BUDGET), progress: r.value, champ: ev.champ!, champStats: ev.champStats!, ruleStats: ev.ruleStats, msPerGen: (performance.now() - t0) / gens });
        t0 = performance.now(); gens = 0;
      }
      yield;
    }
    const hist = ev.hist.slice(from);
    out({ type: "done", run: m.run, stage: m.stage, score: stageScore(hist), hist });
  }
}
export { EVERY };

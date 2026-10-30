// One roguelite run: the same species through the stages, a fixed generation budget per stage.
// Used by the worker and by the page fallback alike, so both give identical results.
// v2: each stage has an event (chosen route), the species carries body cards, and powers can be used
// during a stage; a power takes effect at the next generation and is reported back with that generation,
// so a run is fully set by seed + choices + (power, generation) pairs.
import { Evolver, SPECIES, DEFAULT_SETTINGS, EVENTS, EVERY, type Level, type Sense, type Stats, type Weights, type BodyCard, type EventId, type Power, POWERS } from "./sim.ts";

export const BUDGET = 60; // generations per stage (tuned: proto/tune-run.ts, proto/tune-species.ts)
export const SCORE_CHECKS = 4; // stage score = average of the last 4 checks (no lucky single check)
export const STAGES: Level[] = [
  { id: "S1", name: "Meadow", good: 40, bad: 0, hunters: 0, menu: ["energy"], blurb: "Only food. Learn to find it." },
  { id: "S2", name: "Poison patch", good: 30, bad: 20, hunters: 0, menu: ["poison", "taste", "energy"], blurb: "20 of the 50 beads are poison." },
  { id: "S3", name: "Hunted", good: 40, bad: 8, hunters: 6, menu: ["poison", "hunter", "energy"], blurb: "Six hunters roam; a caught creature is out for the round." },
];

export interface StageStart { type: "stage"; run: number; stage: number; sp: number; seed: number; layers: number[]; build: Sense[]; weights: Weights; event?: EventId; body?: BodyCard[] }
export interface UsePower { type: "power"; run: number; stage: number; power: Power }
export interface Stop { type: "stop" }
export interface Check { type: "check"; run: number; stage: number; gen: number; progress: number; champ: number[]; champStats: Stats; ruleStats: Stats; msPerGen: number }
export interface Powered { type: "powered"; run: number; stage: number; power: Power; gen: number; until: number }
export interface Done { type: "done"; run: number; stage: number; score: number; hist: number[] }
export type In = StageStart | UsePower | Stop;
export type Out = Check | Powered | Done;

export const stageScore = (hist: number[]) => { const w = hist.slice(-SCORE_CHECKS); return w.reduce((s, x) => s + x, 0) / w.length; };
export const stageLevel = (stage: number, event: EventId = "calm") => EVENTS[event].apply(STAGES[stage]);

export class Runner {
  private ev: Evolver | null = null;
  private run = -1;
  private pending: { stage: number; power: Power }[] = [];

  // A power asked for during a stage; applied before the next generation of that stage.
  queue(m: UsePower): void { if (m.run === this.run) this.pending.push({ stage: m.stage, power: m.power }); }

  // Generator for one stage: yields often (page slicing), emits checks, powers and the result through `out`.
  *stage(m: StageStart, out: (o: Out) => void): Generator<void, void> {
    const lv = stageLevel(m.stage, m.event);
    const set = { ...DEFAULT_SETTINGS, weights: m.weights, body: m.body ?? [] };
    if (m.stage === 0 || !this.ev || this.run !== m.run) {
      this.ev = new Evolver(lv, m.build, m.layers, m.seed, set, SPECIES[m.sp]);
      this.run = m.run;
    } else {
      this.ev.set = set;
      this.ev.nextStage(lv, m.build);
    }
    this.pending = [];
    const ev = this.ev, from = ev.hist.length, start = ev.gen, end = start + BUDGET;
    let t0 = performance.now(), gens = 0;
    while (ev.gen < end) {
      for (const p of this.pending.splice(0)) if (p.stage === m.stage) {
        ev.usePower(p.power);
        out({ type: "powered", run: m.run, stage: m.stage, power: p.power, gen: ev.gen - start, until: ev.gen - start + POWER_GENS(p.power) });
      }
      const it = ev.generation();
      let r = it.next();
      while (!r.done) { yield; r = it.next(); }
      gens++;
      if (r.value !== null) {
        out({ type: "check", run: m.run, stage: m.stage, gen: ev.gen - start, progress: r.value, champ: ev.champ!, champStats: ev.champStats!, ruleStats: ev.ruleStats, msPerGen: (performance.now() - t0) / gens });
        t0 = performance.now(); gens = 0;
      }
      yield;
    }
    const hist = ev.hist.slice(from);
    out({ type: "done", run: m.run, stage: m.stage, score: stageScore(hist), hist });
  }
}
const POWER_GENS = (p: Power) => POWERS[p].gens;
export { EVERY };

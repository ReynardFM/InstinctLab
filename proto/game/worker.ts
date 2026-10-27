// Runs evolution off the page's main thread, generation after generation, until told to stop.
import { Evolver, LEVELS, type Sense, type Stats } from "./sim.ts";

export interface Start { type: "start"; attempt: number; level: number; build: Sense[]; layers: number[]; seed: number }
export interface Stop { type: "stop" }
export interface Check { type: "check"; attempt: number; gen: number; progress: number; champ: number[]; champStats: Stats; ruleStats: Stats; msPerGen: number }

let run = 0; // bumps on every start/stop, so an old loop notices it should end
// yield between generations so a stop message gets in (MessageChannel: no setTimeout 4 ms minimum)
const ch = new MessageChannel();
let wake: () => void = () => {};
ch.port1.onmessage = () => wake();
const tick = () => new Promise<void>((ok) => { wake = ok; ch.port2.postMessage(0); });

self.onmessage = async (e: MessageEvent<Start | Stop>) => {
  const m = e.data;
  const me = ++run;
  if (m.type === "stop") return;
  const ev = new Evolver(LEVELS[m.level], m.build, m.layers, m.seed);
  let t0 = performance.now(), gens = 0;
  while (me === run) {
    const p = ev.step();
    gens++;
    if (p !== null) {
      const msPerGen = (performance.now() - t0) / gens;
      t0 = performance.now(); gens = 0;
      (self as unknown as Worker).postMessage({ type: "check", attempt: m.attempt, gen: ev.gen, progress: p, champ: ev.champ!, champStats: ev.champStats!, ruleStats: ev.ruleStats, msPerGen } satisfies Check);
    }
    await tick(); // lets a stop message in
  }
};

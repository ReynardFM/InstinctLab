// Stage 3b: one run, its food maps played at the same time on separate threads.
// Each map of a generation is independent (its own random numbers, everyone starts fresh: see
// engine/world.ts startLayout), so the maps can be played on separate threads and their food counts
// added up; then the generation is bred on this thread as usual. Same numbers as playing the maps one
// after another (test/split.test.ts). Gains up to the number of maps (3 by default) for a single run;
// a grid of runs already keeps every core busy, so this is for long single runs.
import { Worker } from "node:worker_threads";
import { inEcosystem, nextGeneration, type World } from "../engine/world.ts";
import type { LayoutTask, LayoutResult } from "./layout-worker.ts";

export class LayoutPool {
  private workers: Worker[];
  private idle: Worker[];
  private waiting: { task: LayoutTask; ok: (r: LayoutResult) => void; fail: (e: Error) => void }[] = [];

  constructor(size: number) {
    this.workers = Array.from({ length: Math.max(1, size) }, () => new Worker(new URL("./layout-worker.ts", import.meta.url)));
    this.idle = [...this.workers];
  }

  run(task: LayoutTask): Promise<LayoutResult> {
    return new Promise((ok, fail) => {
      this.waiting.push({ task, ok, fail });
      this.next();
    });
  }

  private next(): void {
    while (this.idle.length && this.waiting.length) {
      const w = this.idle.pop()!;
      const { task, ok, fail } = this.waiting.shift()!;
      const done = () => {
        w.off("message", onMessage);
        w.off("error", onError);
        this.idle.push(w);
        this.next();
      };
      const onMessage = (r: LayoutResult) => (done(), ok(r));
      const onError = (e: Error) => (done(), fail(e));
      w.on("message", onMessage);
      w.on("error", onError);
      w.postMessage(task);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// Runs `generations` more generations, each generation's maps on the pool's threads.
export async function runGenerationsSplit(w: World, generations: number, pool: LayoutPool): Promise<void> {
  const r = w.rules;
  const maps = Math.max(1, r.layouts);
  for (let g = 0; g < generations; g++) {
    if (inEcosystem(w)) throw new Error("ecosystem mode has no food maps to split");
    if (r.hunters > 0 && r.hunterBrains > 0) throw new Error("hunters with brains can't be split yet (their brains don't travel to the map threads)");
    const genomes = w.creatures.map((c) => c.g);
    const learning = r.learnRate > 0;
    const results = await Promise.all(
      Array.from({ length: maps }, (_, layout) =>
        pool.run({ rules: r, seed: w.seed, generation: w.generation, layout, genomes, wantBrains: learning && layout === maps - 1 })),
    );
    w.creatures.forEach((c, i) => {
      c.eaten = 0;
      c.poisoned = 0;
      c.caught = 0;
      c.learned = 0;
      for (const res of results) {
        c.eaten += res.eaten[i];
        c.poisoned += res.poisoned[i];
        c.caught += res.caught[i];
        c.learned += res.learned[i];
      }
      const brains = results[maps - 1].brains; // what was learned on the last map is what children inherit
      if (brains) for (let k = 0; k < c.w.length; k++) c.w[k] = brains[i][k];
    });
    w.layout = maps - 1;
    nextGeneration(w);
  }
}

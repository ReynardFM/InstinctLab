// A thread that plays one food map of one generation (cli/split.ts): rebuilds the generation from its
// brains, starts the map, plays it to the end and reports what each creature ate.
import { parentPort } from "node:worker_threads";
import { createWorld, startLayout, tickLayout, type Rules } from "../engine/world.ts";

export interface LayoutTask {
  rules: Rules;
  seed: number;
  generation: number;
  layout: number;
  genomes: number[][]; // in creature order (the order matters: who eats first)
  wantBrains: boolean; // learning on and this is the last map: send back the learned brains
}

export interface LayoutResult {
  eaten: number[];
  poisoned: number[];
  learned: number[];
  brains: number[][] | null;
}

export function playLayout(t: LayoutTask): LayoutResult {
  const w = createWorld(t.seed, t.rules, t.genomes);
  w.generation = t.generation;
  w.layout = t.layout;
  startLayout(w);
  while (!tickLayout(w));
  return {
    eaten: w.creatures.map((c) => c.eaten),
    poisoned: w.creatures.map((c) => c.poisoned),
    learned: w.creatures.map((c) => c.learned),
    brains: t.wantBrains ? w.creatures.map((c) => c.w) : null,
  };
}

parentPort?.on("message", (t: LayoutTask) => parentPort!.postMessage(playLayout(t)));

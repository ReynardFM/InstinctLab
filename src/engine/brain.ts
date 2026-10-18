// A tiny neural network. The genome is just its weights and biases, in reading order.
import { tanh } from "./dmath.ts";

export const IN = 4; // basic senses: food left/right, food ahead, food distance, energy. Extra senses add more.
export const HID = 6;
export const OUT = 2; // turn, speed
export const genomeSize = (inputs: number) => inputs * HID + HID + HID * OUT + OUT;
export const GENOME = genomeSize(IN); // the basic brain

export type Genome = number[];

export interface Thought {
  hidden: number[];
  out: number[]; // each in -1..1
}

export function think(g: Genome, inputs: number[]): Thought {
  let k = 0;
  const hidden: number[] = [];
  const out: number[] = [];
  const n = inputs.length;
  for (let h = 0; h < HID; h++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += inputs[i] * g[k++];
    hidden.push(tanh(s + g[k++]));
  }
  for (let o = 0; o < OUT; o++) {
    let s = 0;
    for (let h = 0; h < HID; h++) s += hidden[h] * g[k++];
    out.push(tanh(s + g[k++]));
  }
  return { hidden, out };
}

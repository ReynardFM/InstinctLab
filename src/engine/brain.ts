// A tiny neural network. The genome is just its weights and biases, in reading order.
import { tanh } from "./dmath.ts";

export const IN = 4; // basic senses: food left/right, food ahead, food distance, energy. Extra senses add more.
export const HID = 6; // middle neurons in the default brain (rules.hidden changes it)
export const OUT = 2; // turn, speed
export const genomeSize = (inputs: number, hidden = HID) => inputs * hidden + hidden + hidden * OUT + OUT;
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
  const nh = (g.length - OUT) / (n + 1 + OUT); // middle neurons, read from the genome's length
  for (let h = 0; h < nh; h++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += inputs[i] * g[k++];
    hidden.push(tanh(s + g[k++]));
  }
  for (let o = 0; o < OUT; o++) {
    let s = 0;
    for (let h = 0; h < nh; h++) s += hidden[h] * g[k++];
    out.push(tanh(s + g[k++]));
  }
  return { hidden, out };
}

// Learning during life: connections that were active shortly before a reward get stronger (food,
// reward +1) or weaker (poison, reward -1). "Shortly before" is an eligibility trace: every tick each
// connection remembers pre x post activity, fading by `decay`. Updates `weights` and `trace` in place
// and returns the total size of the change (what learning costs in energy). Same layout as think().
// rates (rules.plasticity): each connection's own evolved learning rate, read from rates[ratesAt + k];
// it can be negative (that connection learns the opposite way). null = every connection learns at `rate`.
export function learn(
  weights: number[], trace: number[], inputs: number[], hidden: number[], out: number[],
  reward: number, rate: number, decay: number, rates: Genome | null = null, ratesAt = 0,
): number {
  let k = 0;
  let change = 0;
  const step = (pre: number, post: number) => {
    trace[k] = decay * trace[k] + pre * post;
    if (reward !== 0) {
      const d = rate * reward * trace[k] * (rates ? rates[ratesAt + k] : 1);
      weights[k] += d;
      change += d < 0 ? -d : d;
    }
    k++;
  };
  for (let h = 0; h < hidden.length; h++) {
    for (let i = 0; i < inputs.length; i++) step(inputs[i], hidden[h]);
    step(1, hidden[h]); // bias
  }
  for (let o = 0; o < out.length; o++) {
    for (let h = 0; h < hidden.length; h++) step(hidden[h], out[o]);
    step(1, out[o]); // bias
  }
  return change;
}

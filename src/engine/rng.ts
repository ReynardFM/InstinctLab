// Seeded random numbers. Same seed = same sequence, on every machine.
// Each World owns its own Rng, so several worlds can run side by side without interfering.

export interface Rng {
  next(): number; // 0 <= x < 1
  gauss(): number; // bell curve, mostly between -2 and 2
}

export function createRng(seed: number): Rng {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0; // mulberry32
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = next() || 1e-9;
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

// "42" -> 42; any other text -> a stable number derived from it.
export function seedFrom(text: string): number {
  const n = Number(text);
  return Number.isFinite(n) ? n : [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
}

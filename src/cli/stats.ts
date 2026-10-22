// Statistics for the lab: Student's t distribution (exact, any number of seeds) and the stop rule for
// running seeds in batches until the answer is clear (npm run lab -- --auto).

// log Gamma (Lanczos approximation, g = 7): about 15 correct digits for x > 0.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularized incomplete beta I_x(a, b), by its continued fraction (Numerical Recipes, betacf).
function betaCf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}

// P(T <= t) for Student's t with df degrees of freedom.
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * incBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

// The t value with P(T <= t) = p (bisection: exact to about 1e-10).
export function tQuantile(p: number, df: number): number {
  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Half-width of the two-sided confidence interval of the mean of xs, at confidence 1 - alpha.
export function margin(xs: number[], alpha: number): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1));
  return (tQuantile(1 - alpha / 2, n - 1) * sd) / Math.sqrt(n);
}

// The stop rule. diffs = this setting minus the first row, seed by seed, after `look` of `looks` batches.
// Each look uses alpha / looks (Bonferroni), so with several looks the chance of calling a difference
// "real" when there is none stays at or under alpha overall.
//   real    the range excludes 0: a difference, probably real
//   none    the whole range is inside +-care: no difference that matters
//   unclear neither yet (more seeds), or the last look
export type Verdict = "real" | "none" | "unclear";
export function decide(diffs: number[], looks: number, care: number, alpha = 0.05): { verdict: Verdict; mean: number; margin: number } {
  const n = diffs.length;
  const mean = diffs.reduce((s, x) => s + x, 0) / n;
  const m = margin(diffs, alpha / looks);
  if (Number.isNaN(m)) return { verdict: "unclear", mean, margin: m };
  if (Math.abs(mean) > m) return { verdict: "real", mean, margin: m };
  if (Math.abs(mean) + m <= care) return { verdict: "none", mean, margin: m };
  return { verdict: "unclear", mean, margin: m };
}

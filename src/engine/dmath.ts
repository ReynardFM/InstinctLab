// Deterministic math: the same answer, to the last bit, in every JavaScript engine.
//
// The JS spec lets each engine compute Math.sin, cos, tanh, exp, log, atan2 and ** its own way
// ("implementation-approximated"). Measured 2026-10-18: Math.sin and Math.cos differ between Node 22
// and Chrome 141, enough to make the same seed play out differently. These versions use only
// + - * / and Math.floor, which IEEE 754 makes exact and identical everywhere. Accuracy is about
// 1e-15, far more than the simulation needs. Math.sqrt is kept: IEEE 754 requires square root to be
// correctly rounded and engines use the hardware instruction (measured identical Node vs Chrome; that
// the JS spec itself forbids an approximate sqrt is unverified).

// pi/2 split in two (the fdlibm constants): HALF_PI_HI has only 33 significant bits, so k * HALF_PI_HI is
// exact for |k| < 2^20, i.e. angles up to about 1.6 million radians.
const HALF_PI_HI = 1.5707963267341256;
const HALF_PI_LO = 6.077100506506192e-11;
const TWO_OVER_PI = 0.6366197723675814;

const LN2_HI = 0.6931471803691238; // ln 2 split the same way (fdlibm)
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;
const SQRT_HALF = 0.7071067811865476;
const SQRT2 = 1.4142135623730951;

// 1/n! for the Taylor series below
const F = [1];
for (let n = 1; n <= 20; n++) F.push(F[n - 1] / n);

// powers of two, built by exact doubling and halving: P2[64 + k] = 2^k
const P2: number[] = new Array(129);
P2[64] = 1;
for (let i = 1; i <= 64; i++) {
  P2[64 + i] = P2[63 + i] * 2;
  P2[64 - i] = P2[65 - i] / 2;
}

// sin and cos on |r| <= pi/4 (Taylor series to r^19 / r^18: error below 1e-17)
function sinSmall(r: number): number {
  const r2 = r * r;
  return r * (F[0] - r2 * (F[3] - r2 * (F[5] - r2 * (F[7] - r2 * (F[9] - r2 * (F[11] - r2 * (F[13] - r2 * (F[15] - r2 * (F[17] - r2 * F[19])))))))));
}
function cosSmall(r: number): number {
  const r2 = r * r;
  return F[0] - r2 * (F[2] - r2 * (F[4] - r2 * (F[6] - r2 * (F[8] - r2 * (F[10] - r2 * (F[12] - r2 * (F[14] - r2 * (F[16] - r2 * F[18]))))))));
}

// x = k * pi/2 + r with |r| <= pi/4, then pick sin or cos of r by the quarter k mod 4.
// (Written out in both functions instead of returning a pair: these run for every creature every tick.)
export function sin(x: number): number {
  const k = Math.floor(x * TWO_OVER_PI + 0.5);
  const r = x - k * HALF_PI_HI - k * HALF_PI_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? sinSmall(r) : q === 1 ? cosSmall(r) : q === 2 ? -sinSmall(r) : -cosSmall(r);
}

export function cos(x: number): number {
  const k = Math.floor(x * TWO_OVER_PI + 0.5);
  const r = x - k * HALF_PI_HI - k * HALF_PI_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? cosSmall(r) : q === 1 ? -sinSmall(r) : q === 2 ? -cosSmall(r) : sinSmall(r);
}

// e^x for |x| <= 44 (x = k ln2 + r, |r| <= 0.35, Taylor to r^17)
function expSmall(x: number): number {
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO;
  let p = F[17];
  for (let n = 16; n >= 0; n--) p = p * r + F[n];
  return p * P2[64 + k];
}

export function tanh(x: number): number {
  if (x !== x) return NaN;
  const a = x < 0 ? -x : x;
  let t: number;
  if (a >= 20) t = 1; // 1 - tanh(20) is below half the gap between 1 and the next double down
  else if (a < 0.05) {
    // Taylor series: accurate where the formula below would lose digits
    const a2 = a * a;
    t = a * (1 - a2 * (1 / 3 - a2 * (2 / 15 - a2 * (17 / 315 - a2 * (62 / 2835 - a2 * (1382 / 155925))))));
  } else {
    const e = expSmall(-2 * a);
    t = (1 - e) / (1 + e);
  }
  return x < 0 ? -t : t;
}

// natural log for x > 0: x = m * 2^e with m near 1, then log m = 2 atanh((m-1)/(m+1)) as a series
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let m = x;
  let e = 0;
  while (m < SQRT_HALF) {
    m *= 2;
    e--;
  }
  while (m >= SQRT2) {
    m /= 2;
    e++;
  }
  const s = (m - 1) / (m + 1); // |s| <= 0.172
  const s2 = s * s;
  let p = 1 / 23;
  for (let n = 21; n >= 1; n -= 2) p = p * s2 + 1 / n;
  return e * LN2_HI + (e * LN2_LO + 2 * s * p);
}

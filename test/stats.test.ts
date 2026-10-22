// Lab statistics (src/cli/stats.ts): exact t values and the stop rule for --auto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, margin, tCdf, tQuantile } from "../src/cli/stats.ts";
import { createRng } from "../src/engine/rng.ts";

test("t distribution matches published values (scipy.stats.t)", () => {
  // [df, 97.5% point, 99.375% point (5% split over 4 looks), P(T <= 2)]
  const known = [
    [1, 12.7062, 50.923, 0.852416],
    [6, 2.4469, 3.5212, 0.953787],
    [13, 2.1604, 2.8961, 0.96658],
    [20, 2.086, 2.7444, 0.970367],
    [27, 2.0518, 2.6763, 0.972174],
  ];
  for (const [df, q975, q99375, cdf2] of known) {
    assert.ok(Math.abs(tQuantile(0.975, df) - q975) < 1e-3, `df ${df}`);
    assert.ok(Math.abs(tQuantile(1 - 0.0125 / 2, df) - q99375) < 1e-3, `df ${df}`);
    assert.ok(Math.abs(tCdf(2, df) - cdf2) < 1e-5, `df ${df}`);
  }
  assert.equal(margin([4, 4, 4], 0.05), 0);
});

test("stop rule: real differences found, false alarms at or under 5% over 4 looks", () => {
  const rng = createRng(11);
  const run = (mean: number) => {
    const d: number[] = [];
    for (let look = 1; look <= 4; look++) {
      for (let i = 0; i < 7; i++) d.push(mean + 2 * rng.gauss());
      const v = decide(d, 4, 1).verdict;
      if (v !== "unclear" || look === 4) return v;
    }
    return "unclear";
  };
  const N = 2000;
  const rate = (mean: number, verdict: string) => Array.from({ length: N }, () => run(mean)).filter((v) => v === verdict).length / N;
  assert.ok(rate(0, "real") <= 0.05, "no true difference: called real at most 5% of the time");
  assert.ok(rate(2, "real") >= 0.95, "a true difference of 2 is found");
  assert.ok(rate(1.5, "none") <= 0.01, "a difference bigger than care is almost never called nothing");
  // the verdicts themselves
  assert.equal(decide([3, 3.2, 2.9, 3.1, 3, 2.8, 3.3], 4, 1).verdict, "real");
  assert.equal(decide([0.01, -0.02, 0.03, 0, -0.01, 0.02, 0], 4, 1).verdict, "none");
  assert.equal(decide([2, -2, 1.5, -1, 0.5, -1.8, 1], 4, 1).verdict, "unclear");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { combinations, margin95, parseArgs, score } from "../src/cli/run.ts";
import { runJob, type Job } from "../src/cli/job.ts";
import { runJobs } from "../src/cli/pool.ts";
import { median, workerCounts } from "../src/cli/bench.ts";
import { DEFAULT_RULES } from "../src/engine/world.ts";

test("reads options and lists of values", () => {
  const o = parseArgs(["--gens=50", "--seeds=4,5", "--mutation=0.1,0.2"]);
  assert.equal(o.gens, 50);
  assert.deepEqual(o.seeds, [4, 5]);
  assert.deepEqual(o.grid.mutation, [0.1, 0.2]);
  assert.equal(parseArgs(["--workers=3"]).workers, 3);
  assert.ok(parseArgs([]).workers >= 1, "defaults to the number of cores");
  assert.throws(() => parseArgs(["--speed=3"]), /Unknown option/);
  assert.throws(() => parseArgs(["--food=lots"]), /needs numbers/);
});

test("builds every combination", () => {
  const c = combinations({ food: [10, 60], mutation: [0.1, 0.2, 0.3] });
  assert.equal(c.length, 6);
  assert.deepEqual(c[0], { ...DEFAULT_RULES, food: 10, mutation: 0.1 });
});

test("score averages the last 10 generations", () => {
  assert.equal(score([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 1);
  assert.equal(score([2, 4]), 3);
});

test("worker threads give exactly the same results as running in one thread, in job order", async () => {
  const small = { ...DEFAULT_RULES, pop: 10, food: 15, genTicks: 200 };
  const jobs: Job[] = [5, 1, 4, 2, 3].map((seed) => ({ seed, rules: { ...small, layouts: seed % 2 ? 1 : 2 }, gens: 3 }));
  const inline = jobs.map(runJob);
  assert.deepEqual(await runJobs(jobs, 1), inline);
  assert.deepEqual(await runJobs(jobs, 3), inline);
  assert.deepEqual(await runJobs(jobs, 50), inline, "more workers than jobs is fine");
  assert.deepEqual(await runJobs([], 4), []);
});

test("a run that crashes inside a worker is reported, not left hanging", async () => {
  const broken: Job = { seed: 1, rules: { ...DEFAULT_RULES, pop: 0 }, gens: 1 }; // no creatures to rank
  await assert.rejects(runJobs([broken], 1));
});

test("bench tries 1, 2, 4 ... workers up to the core count", () => {
  assert.deepEqual(workerCounts(1), [1]);
  assert.deepEqual(workerCounts(2), [1, 2]);
  assert.deepEqual(workerCounts(6), [1, 2, 4, 6]);
  assert.deepEqual(workerCounts(8), [1, 2, 4, 8]);
});

test("margin95: zero spread gives 0, one seed gives no margin, more seeds give a narrower range", () => {
  assert.equal(margin95([5, 5, 5]), 0);
  assert.ok(Number.isNaN(margin95([5])));
  assert.ok(Math.abs(margin95([1, 3]) - 12.71) < 1e-9); // sd 1.414, n 2, t 12.71
  assert.ok(margin95([1, 3, 1, 3, 1, 3, 1]) < margin95([1, 3, 1]));
  assert.deepEqual(parseArgs([]).seeds, [1, 2, 3, 4, 5, 6, 7]);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

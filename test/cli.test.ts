import { test } from "node:test";
import assert from "node:assert/strict";
import { combinations, learning, margin95, pairedDiff, parseArgs, score, seedList } from "../src/cli/run.ts";
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
  assert.equal(parseArgs([]).queue, null, "threads unless asked");
  assert.equal(parseArgs([]).ticks, 20000);
  assert.equal(parseArgs(["--ticks=5000"]).ticks, 5000);
  assert.equal(combinations({ mode: [1] })[0].regrow, 100, "ecosystem: food regrows after 100 ticks, like the page");
  assert.equal(combinations({ mode: [1], regrow: [0] })[0].regrow, 0, "unless asked");
  assert.equal(combinations({})[0].regrow, 0);
  assert.equal(parseArgs(["--queue"]).queue, "redis://localhost:6379");
  assert.equal(parseArgs(["--queue=redis://box:7000", "--gens=5"]).queue, "redis://box:7000");
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

test("ecosystem runs: warm-up, then the given ticks; same result in a thread", async () => {
  const job = { seed: 3, rules: { ...DEFAULT_RULES, mode: 1, ecoWarmup: 1, regrow: 100 }, gens: 0, ticks: 2000 };
  const inline = runJob(job);
  assert.ok(inline.eco, "ecosystem results are there");
  assert.equal(inline.eco!.popHist.length, 20, "a population sample every 100 ticks");
  assert.equal(inline.avgHist.length, 1, "one warm-up generation");
  assert.deepEqual((await runJobs([job], 1))[0], inline);
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

test("early learning averages the first 30 generations, so a faster climb to the same plateau scores higher", () => {
  const fast = [10, 30, ...new Array(98).fill(40)];
  const slow = [10, 15, 20, 30, ...new Array(96).fill(40)];
  assert.ok(learning(fast) > learning(slow));
  assert.equal(learning([10, 20]), 15);
  assert.equal(score(fast), score(slow), "same plateau");
});

test("paired differences cancel shared luck; seed ranges expand", () => {
  // big seed-to-seed swings, but this setting is always exactly 1 better
  const ref = [10, 30, 20, 50, 40];
  const better = ref.map((x) => x + 1);
  const d = pairedDiff(better, ref);
  assert.equal(d.mean, 1);
  assert.equal(d.margin, 0);
  assert.deepEqual(seedList("1-4,9"), [1, 2, 3, 4, 9]);
  assert.deepEqual(parseArgs(["--seeds=1-3"]).seeds, [1, 2, 3]);
});

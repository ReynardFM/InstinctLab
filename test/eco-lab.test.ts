// npm run eco-lab: its metrics, its defaults, and that counting the measures never changes a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES } from "../src/engine/world.ts";
import { runJob } from "../src/cli/job.ts";
import { cycles, ecoMetrics, familySplit } from "../src/cli/eco-metrics.ts";
import { ecoJobs, ecoRows, report } from "../src/cli/eco-lab.ts";

test("cycles: a flat line has none; three clear waves are three", () => {
  assert.equal(cycles(new Array(300).fill(50)), 0);
  const wave = Array.from({ length: 300 }, (_, i) => 50 + 30 * Math.sin((2 * Math.PI * i) / 100 - Math.PI / 2));
  assert.equal(cycles(wave), 3);
});

test("familySplit: biggest quarter of the families vs the rest, by member-ticks", () => {
  const fams = [
    { eat: 10, ticks: 10000 }, { eat: 5, ticks: 9000 }, { eat: 1, ticks: 8000 }, { eat: 8, ticks: 6000 },
    { eat: 99, ticks: 100 }, // too small to count
  ];
  const s = familySplit(fams);
  assert.equal(s.top, 1); // the biggest one: 10 per 10000 ticks = 1 per 1000
  assert.ok(Math.abs(s.rest - (5000 / 9000 + 1000 / 8000 + 8000 / 6000) / 3) < 1e-12);
  assert.ok(Number.isNaN(familySplit(fams.slice(0, 3)).top), "fewer than 4 families: no split");
});

test("ecoMetrics: brief checks from the rounds", () => {
  const e = { popHist: [10, 10], ageHist: [], births: 0, deaths: 0, oldAge: 0, rescues: 0, ticks: 30000, roundStart: 9000,
    rounds: [{ start: 0, end: 4000, died: "hunters" as const }, { start: 4000, end: 9000, died: "prey" as const }], hunterPopHist: [2, 2] };
  const m = ecoMetrics(e);
  assert.equal(m.pass, true, "the round still running (9000 -> 30000) counts");
  assert.equal(m.killed, false);
  assert.equal(m.hunterDieOuts, 1);
  assert.equal(m.preyDieOuts, 1);
});

const SMALL = { ...DEFAULT_RULES, mode: 1, regrow: 100, hunters: 4, food: 60, foodSpread: 0.0005, pop: 20, genTicks: 300, ecoWarmup: 2 };

test("counting the measures never changes the run (only adds numbers)", () => {
  const a = runJob({ seed: 3, rules: SMALL, gens: 0, ticks: 4000 });
  const b = runJob({ seed: 3, rules: SMALL, gens: 0, ticks: 4000, measure: true });
  const { defence, ...rest } = b.eco!;
  assert.ok(defence && defence.win.length > 0, "measured");
  assert.deepEqual(rest, a.eco);
  assert.deepEqual(b.avgHist, a.avgHist);
});

test("eco-lab defaults: 14 seeds x 60,000 ticks on the tuned ecosystem, every combination, measured", () => {
  const { jobs, combos, seeds } = ecoJobs(["--hunterSpit=0,1"]);
  assert.equal(seeds.length, 14);
  assert.equal(combos.length, 2);
  assert.equal(jobs.length, 28);
  assert.ok(jobs.every((j) => j.ticks === 60000 && j.measure && j.rules.mode === 1 && j.rules.hunters === 4 && j.rules.foodSpread === 0.0005));
  const small = ecoJobs(["--seeds=1-3", "--ticks=500", "--food=120"]);
  assert.equal(small.jobs.length, 3);
  assert.equal(small.jobs[0].ticks, 500);
  assert.equal(small.jobs[0].rules.food, 120);
});

test("eco-lab report: rows, the brief verdict and the paired line", () => {
  const { jobs, combos, seeds } = ecoJobs(["--seeds=1-2", "--ticks=1500", "--pop=20", "--genTicks=300", "--ecoWarmup=2", "--hunterSpit=0,1"]);
  const results = jobs.map(runJob);
  const text = report(ecoRows(combos, seeds, results), seeds);
  assert.match(text, /brief: done \d\/2 \(needs 2\)/);
  assert.match(text, /paired by seed, minus the first row/);
  assert.match(text, /hunterSpit=1/);
});

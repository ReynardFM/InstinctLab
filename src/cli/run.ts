// Headless experiment runner: compare rule settings across several seeds, no browser.
//
// npm run lab -- --gens=100 --seeds=1,2,3 --mutation=0.05,0.15,0.3
//
// Any rule (pop, food, genTicks, elite, parents, mutation, layouts, ...) can take a comma-separated list.
// Every combination is run once per seed. Runs are spread over all CPU cores; --workers=N to change.
import { availableParallelism } from "node:os";
import { DEFAULT_RULES, type Rules } from "../engine/world.ts";
import type { Job } from "./job.ts";
import { runJobs } from "./pool.ts";

interface Options {
  gens: number;
  seeds: number[];
  workers: number;
  grid: Partial<Record<keyof Rules, number[]>>;
}

export function parseArgs(argv: string[]): Options {
  // 7 seeds by default: with 3, differences of about 2 food were indistinguishable from luck
  const opts: Options = { gens: 100, seeds: [1, 2, 3, 4, 5, 6, 7], workers: availableParallelism(), grid: {} };
  for (const arg of argv) {
    const m = /^--(\w+)=(.+)$/.exec(arg);
    if (!m) throw new Error(`Can't read "${arg}". Use --name=value or --name=a,b,c`);
    const [, key, raw] = m;
    const values = raw.split(",").map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new Error(`--${key} needs numbers, got "${raw}"`);
    if (key === "gens") opts.gens = values[0];
    else if (key === "seeds") opts.seeds = values;
    else if (key === "workers") opts.workers = Math.max(1, Math.floor(values[0]));
    else if (key in DEFAULT_RULES) opts.grid[key as keyof Rules] = values;
    else throw new Error(`Unknown option --${key}. Rules: ${Object.keys(DEFAULT_RULES).join(", ")}`);
  }
  return opts;
}

// Every combination of the listed values, filled out with the defaults.
export function combinations(grid: Options["grid"]): Rules[] {
  let combos: Rules[] = [{ ...DEFAULT_RULES }];
  for (const [key, values] of Object.entries(grid) as [keyof Rules, number[]][]) {
    combos = combos.flatMap((r) => values.map((v) => ({ ...r, [key]: v })));
  }
  return combos;
}

// Two-sided 95% t-values by degrees of freedom (n - 1), for the ± column.
const T95 = [NaN, 12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09];

// Half-width of the 95% confidence interval of the mean across seeds: the score is probably within
// mean ± this. Two settings whose intervals overlap a lot are not shown to differ. NaN with one seed.
export function margin95(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return ((T95[n - 1] ?? 1.96) * sd) / Math.sqrt(n);
}

// Score of one run: average food eaten over its last 10 generations (less noisy than the last one alone).
export function score(avgHist: number[]): number {
  const tail = avgHist.slice(-10);
  return tail.reduce((s, x) => s + x, 0) / tail.length;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const combos = combinations(opts.grid);
  const varied = Object.keys(opts.grid) as (keyof Rules)[];
  const jobs: Job[] = combos.flatMap((rules) => opts.seeds.map((seed) => ({ seed, rules, gens: opts.gens })));
  const workers = Math.min(opts.workers, jobs.length);
  console.log(`${combos.length} setting(s) x ${opts.seeds.length} seed(s) x ${opts.gens} generations, ${workers} worker(s)\n`);

  const t0 = performance.now();
  const progress = process.stderr.isTTY
    ? (done: number) => process.stderr.write(`\r${done} of ${jobs.length} runs done`)
    : undefined;
  const results = await runJobs(jobs, workers, progress);
  if (progress) process.stderr.write("\r\x1b[K");
  const secs = (performance.now() - t0) / 1000;
  const totalGens = jobs.length * opts.gens;

  const rows: string[][] = [];
  for (const [i, rules] of combos.entries()) {
    const mine = results.slice(i * opts.seeds.length, (i + 1) * opts.seeds.length);
    const scores = mine.map((r) => score(r.avgHist));
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
    const top = mine.map((r) => score(r.topHalfHist)).reduce((s, x) => s + x, 0) / mine.length;
    const m = margin95(scores);
    rows.push([
      ...varied.map((k) => String(rules[k])),
      mean.toFixed(1),
      Number.isNaN(m) ? "-" : `±${m.toFixed(1)}`,
      top.toFixed(1),
      `${Math.min(...scores).toFixed(1)}..${Math.max(...scores).toFixed(1)}`,
    ]);
  }

  const header = [...varied, "score", "±95%", "top half", "seed range"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join("  ");
  console.log(line(header));
  for (const r of rows) console.log(line(r));
  console.log(`\nscore = average food eaten per creature per layout, last 10 generations, averaged over seeds`);
  console.log(`±95% = the true score is probably within score ± this; settings whose ranges overlap are not shown to differ`);
  console.log(`top half = the same for the better half of each generation (weak newcomers don't drag it down); seed range is for score`);
  console.log(`${totalGens} generations in ${secs.toFixed(1)} s = ${(totalGens / secs).toFixed(1)} generations/s (${workers} worker${workers > 1 ? "s" : ""})`);
}

if (import.meta.main ?? process.argv[1]?.endsWith("run.ts")) await main();

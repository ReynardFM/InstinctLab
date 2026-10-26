// Ecosystem experiments with hunters: compare rule settings across seeds, paired by seed against the first row.
//
// npm run eco-lab -- --hunterSpit=0,1                     (14 seeds x 60,000 ticks by default)
// npm run eco-lab -- --poisonDose=0,1 --seeds=1-7 --ticks=30000
// npm run eco-lab -- --resistTrain=0,0.5 --queue          (runs on the Redis worker containers, README stage 4)
//
// Starts from the tuned ecosystem (mode 1, 4 hunters, food 60 spreading at 0.0005, regrow 100); any rule can
// take a comma list and every combination runs once per seed. Reports Rey's brief checks (done: a 20,000-tick
// round with both sides alive in 10+ of 14 seeds; kill: no round past 5,000 ticks), rise-and-fall cycles,
// die-outs, poison, how hunters pick (sick vs fresh prey) and the poison-defence measures (eco-metrics.ts).
import { DEFAULT_RULES, type Rules } from "../engine/world.ts";
import type { Job, JobResult } from "./job.ts";
import { runJobs } from "./pool.ts";
import { combinations, pairedDiff, parseArgs, seedList } from "./run.ts";
import { ecoMetrics, type EcoMetrics } from "./eco-metrics.ts";

export const ECO_BASE: Partial<Record<keyof Rules, number[]>> = { mode: [1], hunters: [4], food: [60], foodSpread: [0.0005], regrow: [100] };
export const DONE_SHARE = 10 / 14; // the brief: 10 of 14 seeds

export interface EcoRow {
  rules: Rules;
  changed: string; // the rules that differ from the base, e.g. "hunterSpit=1"
  runs: EcoMetrics[]; // one per seed, in seed order
}

export function ecoJobs(argv: string[]): { jobs: Job[]; combos: Rules[]; seeds: number[]; queue: string | null; workers: number } {
  const opts = parseArgs(argv);
  const seeds = argv.some((a) => a.startsWith("--seeds=")) ? opts.seeds : seedList("1-14");
  const ticks = argv.some((a) => a.startsWith("--ticks=")) ? opts.ticks : 60000;
  const grid = { ...ECO_BASE, ...opts.grid };
  const combos = combinations(grid);
  const jobs = combos.flatMap((rules) => seeds.map((seed) => ({ seed, rules, gens: 0, ticks, measure: true })));
  return { jobs, combos, seeds, queue: opts.queue, workers: opts.workers };
}

const base = combinations(ECO_BASE)[0];
const describe = (r: Rules) =>
  (Object.keys(r) as (keyof Rules)[]).filter((k) => r[k] !== base[k]).map((k) => `${k}=${r[k]}`).join(" ") || "(base)";

export function ecoRows(combos: Rules[], seeds: number[], results: JobResult[]): EcoRow[] {
  return combos.map((rules, k) => ({
    rules,
    changed: describe(rules),
    runs: results.slice(k * seeds.length, (k + 1) * seeds.length).map((r) => ecoMetrics(r.eco!)),
  }));
}

const avg = (xs: number[]) => {
  const ok = xs.filter(Number.isFinite);
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : NaN;
};
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");

export function report(rows: EcoRow[], seeds: number[]): string {
  const n = seeds.length;
  const need = Math.ceil(DONE_SHARE * n);
  const out: string[] = [];
  for (const row of rows) {
    const m = row.runs;
    const count = (p: (x: EcoMetrics) => boolean) => m.filter(p).length;
    out.push(`${row.changed}`);
    out.push(`  brief: done ${count((x) => x.pass)}/${n} (needs ${need}) ${count((x) => x.pass) >= need ? "PASS" : "not yet"}, killed ${count((x) => x.killed)}/${n}` +
      ` | both sides cycle 2+: ${count((x) => x.bothCycle)}/${n} | die-outs: hunters ${m.reduce((s, x) => s + x.hunterDieOuts, 0)}, prey ${m.reduce((s, x) => s + x.preyDieOuts, 0)}`);
    out.push(`  alive: prey ${f(avg(m.map((x) => x.prey)), 1)}, hunters ${f(avg(m.map((x) => x.hunters)), 1)} | poison per prey per 1000 ticks ${f(avg(m.map((x) => x.poison)), 3)}, sick ${f(100 * avg(m.map((x) => x.sick)), 1)}%` +
      ` | pick ${f(avg(m.map((x) => x.pick)))} (1 = eats anything) | poison near a hunter / none: ${f(avg(m.map((x) => x.nearFarFirst)))} -> ${f(avg(m.map((x) => x.nearFarLast)))} (defence = above 1)` +
      ` | biggest families vs rest: ${f(avg(m.map((x) => x.famTop)), 3)} vs ${f(avg(m.map((x) => x.famRest)), 3)}`);
  }
  if (rows.length > 1) {
    out.push("", `paired by seed, minus the first row (${rows[0].changed}); * = probably real:`);
    const ref = rows[0].runs;
    const keys: [string, (x: EcoMetrics) => number][] = [
      ["prey alive", (x) => x.prey], ["hunters alive", (x) => x.hunters], ["hunter die-outs", (x) => x.hunterDieOuts],
      ["poison eaten", (x) => x.poison], ["pick", (x) => x.pick], ["near/far last", (x) => x.nearFarLast],
    ];
    for (const row of rows.slice(1)) {
      const parts = keys.map(([name, g]) => {
        const pairs = row.runs.map((x, i) => [g(x), g(ref[i])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
        if (pairs.length < 2) return `${name} -`;
        const d = pairedDiff(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
        return `${name} ${d.mean >= 0 ? "+" : ""}${f(d.mean)} ±${f(d.margin)}${Math.abs(d.mean) > d.margin ? " *" : ""}`;
      });
      out.push(`  ${row.changed}: ${parts.join(" | ")}`);
    }
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const { jobs, combos, seeds, queue, workers } = ecoJobs(process.argv.slice(2));
  console.log(`${combos.length} setting(s) x ${seeds.length} seeds x ${jobs[0].ticks} ticks${queue ? ` through ${queue}` : ` on ${Math.min(workers, jobs.length)} threads`}`);
  const t0 = performance.now();
  const progress = (done: number) => process.stdout.write(`\r  ${done} of ${jobs.length} runs done`);
  let results: JobResult[];
  if (queue) {
    const { runJobsOnQueue } = await import("../queue/redis-queue.ts");
    results = await runJobsOnQueue(jobs, queue, progress);
  } else results = await runJobs(jobs, Math.min(workers, jobs.length), progress);
  const secs = (performance.now() - t0) / 1000;
  console.log(`\r  ${jobs.length} runs in ${secs.toFixed(0)} s\n`);
  console.log(report(ecoRows(combos, seeds, results), seeds));
}

if (import.meta.main ?? process.argv[1]?.endsWith("eco-lab.ts")) await main();
export { DEFAULT_RULES };

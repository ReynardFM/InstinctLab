// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
// LAB_PRIORITY=normal in the environment keeps normal priority. Testing rule: ask Rey before every batch (threads and priority)
const W = `--workers=${Math.max(1, Math.floor(availableParallelism() / 2))}`; // safe default: half; testing rule: ask Rey before every batch
const S14 = "--seeds=1-14";
// The queue below holds only tests still to run; finished ones are removed once their results are in HISTORY.md (git keeps them).
// DEFAULTS THAT CHANGE BEHAVIOUR (all runs): hunterLearn 0.02, hunterCue 1 (speed) unless a test sets it, relativeReward 1 + forget 0.002 (also for hunters).
// Shared flags: E = both eyes; SAME = prey-like hunter breeding; FOOD2 = twice the food. worksGate(name) = run only if that "works" test passed.
const E = ["--hunterEye=4", "--eyeMotion=1"];
// the evidence ladder: screen = --seeds=1 --ticks=30000; CHECK = 6 seeds x 30k; PROOF = 14 seeds x 200k (kept for the next tests)
export const CHECK = ["--seeds=1-6", "--ticks=30000"], PROOF = [S14, "--ticks=200000"];
type Test = [name: string, what: string, args: string[], skipIf?: () => string | null];
const SAME = ["--hunterMature=0", "--hunterBirth=1.2", "--hunterBirthChance=1"];
// gate: the base world must work (>= 10 of 14 in either condition) in the named works run before its poison runs start
export const worksGate = (name: string) => (): string | null => {
  const f = `${DIR}/${name}.json`;
  if (!existsSync(f)) return `${name} missing`;
  const A = JSON.parse(readFileSync(f, "utf8")) as { cond: number; m: { works: boolean } }[];
  const best = Math.max(...[0, 1].map((c) => A.filter((r) => r.cond === c && r.m.works).length));
  return best >= 10 ? null : `${name}: base world works in only ${best} of 14: poison runs not run`;
};
// Testing rule (Rey 2026-11-11): small first, the proof runs by itself on a pass. Gate: the named small test must work in >= need
// seeds (in either condition) for its proof to run.
export const passGate = (name: string, need: number) => (): string | null => {
  const f = `${DIR}/${name}.json`;
  if (!existsSync(f)) return `${name} missing`;
  const A = JSON.parse(readFileSync(f, "utf8")) as { cond: number; m: { works: boolean } }[];
  const best = Math.max(...[0, 1].map((c) => A.filter((r) => r.cond === c && r.m.works).length));
  return best >= need ? null : `${name}: works in only ${best} seeds (needs ${need}): proof not run`;
};
// SLOW hunters (Rey 2026-11-11: "keep slow hunter ... as the default"): they burn 1/4 and a meal gives 1/4; the needed catch rate is unchanged
const SLOW = ["--hunterHunger=0.000625", "--hunterMeal=0.125"];
const FOOD2 = ["--food=120"]; // "bigger world" (Rey 2026-11-09: b): twice the food on the same 800 x 600 map (the map size is not a setting)
// Sweet-spot gate (Rey 2026-11-11): run the proof only if, in the 6-seed check, the real arm beats its control on BOTH pick (lower) and
// hunters (more) in >= 5 of 6 paired seeds, in at least one condition.
const sweetGate = (real: string, control: string) => (): string | null => {
  const f = (n: string) => `${DIR}/${n}.json`;
  if (!existsSync(f(real)) || !existsSync(f(control))) return `${real} / ${control} missing`;
  type R = { cond: number; seed: number; m: { pick: number; hunters: number } };
  const A = JSON.parse(readFileSync(f(real), "utf8")) as R[], B = JSON.parse(readFileSync(f(control), "utf8")) as R[];
  const best = Math.max(...[0, 1].map((c) => A.filter((r) => r.cond === c && B.some((q) => q.cond === c && q.seed === r.seed && r.m.pick < q.m.pick && r.m.hunters > q.m.hunters)).length));
  return best >= 5 ? null : `${real} beat ${control} on pick AND hunters in only ${best} of 6: proof not run`;
};
const TESTS: Test[] = [
  // (3a) Rey 2026-11-13 ("make a small test with slow hunter as that is the default, 3 seeds x 100k; can we pick the seed?").
  //     Run alone with: node src/cli/night-batch.ts --only=s3. The leftovers that were only ever tested with FAST hunters, one at a time,
  //     on the slow-hunter world (dose 0.75, steady poison). Seeds picked BEFORE the run from four old slow-hunter proofs, one of each kind:
  //     13 (few hunters, avg 18), 9 (middle, 23), 14 (many, 29). Seeds carry over for hunter numbers (r 0.2-0.7 between runs) but not for
  //     die-outs or pick (r ~0). Every arm uses the same three seeds, so each compares with the baseline seed by seed.
  //     3 seeds is a hint only: labels "better / same / worse than baseline in N of 3". No gated proofs (too small to gate on).
  ["s3-base-glow", "BASELINE: glow, slow hunters, dose 0.75, seeds 13 / 9 / 14 x 100k [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=2"]],
  ["s3-base-blind", "BASELINE: blind, same [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=0"]],
  ["s3-idle-glow", "cheap waiting (hunterIdle 0.25), glow [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=2", "--hunterIdle=0.25"]],
  ["s3-bite-glow", "the bite (hunterBite 1), glow [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=2", "--hunterBite=1"]],
  ["s3-reallife-glow", "real-lifespan rule (hunterRealLife 1), glow [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=2", "--hunterRealLife=1"]],
  ["s3-scent", "scent cue (hunterCue 4) in place of glow [small test]", ["--seeds=13,9,14", "--ticks=100000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterCue=4"]],
  // Empty on 2026-11-13: every queued test is finished and recorded in HISTORY.md (git keeps the old entries; last full queue: 26f0ccb).
  // Helpers above: E, SAME, SLOW (now the engine default), FOOD2, CHECK, PROOF, worksGate, sweetGate, passGate. --only=<name start> runs a subset.
];

mkdirSync(DIR, { recursive: true });
const t0 = performance.now();
// --only=<start of a test name>: run just the tests whose name starts with it (Rey 2026-11-11: "just that"); the rest stay queued
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
for (const [name, what, args, skipIf] of TESTS) {
  if (ONLY && !name.startsWith(ONLY)) continue;
  const file = `${DIR}/${name}.txt`;
  if (existsSync(file)) { console.log(`skip ${name} (done)`); continue; }
  const why = skipIf?.();
  if (why) { console.log(`skip ${name}: ${why}`); writeFileSync(file, `== ${name}: ${what}\nSKIPPED by gate: ${why}\n`); continue; }
  console.log(`run ${name}: ${what} (${((performance.now() - t0) / 60000).toFixed(0)} min in)`);
  // stderr goes straight to the terminal, so the per-run progress lines of life-genes show live (Rey 2026-11-11)
  const r = spawnSync(process.execPath, ["src/cli/life-genes.ts", W, `--out=${name}`, ...args], { encoding: "utf8", maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "inherit"] });
  const out = `== ${name}: ${what}\n${r.stdout}${r.status ? `\nFAILED (exit ${r.status}): see the terminal for the error` : ""}`;
  if (r.status) console.log(`  FAILED, see ${file}`);
  if (!r.status) writeFileSync(file, out);
  else writeFileSync(`${DIR}/${name}.failed.txt`, out);
}
const all = TESTS.map(([n]) => `${DIR}/${n}.txt`).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
writeFileSync(`${DIR}/batch-summary.txt`, all);
console.log(`batch done in ${((performance.now() - t0) / 60000).toFixed(0)} min -> ${DIR}/batch-summary.txt`);

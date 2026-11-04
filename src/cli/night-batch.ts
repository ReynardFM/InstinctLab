// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
const W = `--workers=${Math.max(1, Math.floor(availableParallelism() / 2))}`; // half the threads (Rey 2026-11-02: reverted from max)
const S14 = "--seeds=1-14";
// Night 2026-11-04 (Rey: "prep for overnight batch"). Older nights (m1-m22, n/q tests) are in git at 9942908: they used RAW hunter
// learning, and hunters now learn relative + forget by default, so re-running them would answer a different question.
// DEFAULTS THAT CHANGE BEHAVIOUR (all runs below): hunterLearn 0.02, hunterSeeSpeed 1, relativeReward 1 + forget 0.002 (now also for hunters).
// World, fixed up front (no tuning after seeing a result): life mode, prey eye 4, hunterEye 4, eyeMotion 1, food/regrow from ECO_BASE.
// Both conditions of life-genes run (senses handed out / sense genes evolved); the numbers below are read per condition.
//   z* = step 1, ZERO POINT (poison ON, dose 1): what a random-picking hunter would score on the pick scale. Counting only.
//   w* = step 4, WORKS in the base world (HARMLESS poison, --poisonDose=0): no die-out in the last 10k ticks AND each side cycled >= 1
//        inside the running round. Pass = >= 10 of 14 seeds in a condition (read it in the proof run w3).
// Gates (evidence ladder): z2 (check) runs only if z1's zero point (within 200px) is >= 0.2 away from 1 in either condition.
// w2/w3 are NOT gated on "works": a 30k screen can be too short to see a cycle (risk noted 2026-11-03), so a gate on it could kill the proof.
const E = ["--hunterEye=4", "--eyeMotion=1"];
const SCREEN = ["--seeds=1", "--ticks=30000"], CHECK = ["--seeds=1-6", "--ticks=30000"], PROOF = [S14, "--ticks=200000"];
type Test = [name: string, what: string, args: string[], skipIf?: () => string | null];
const zeroFarFromOne = (): string | null => {
  const f = `${DIR}/z1-zero-screen.txt`;
  if (!existsSync(f)) return null;
  const zs = [...readFileSync(f, "utf8").matchAll(/within 200px (\d+\.\d+)/g)].map((m) => Number(m[1]));
  if (!zs.length) return null;
  return zs.some((z) => Math.abs(z - 1) >= 0.2) ? null : `z1 zero point within 200px ${zs.join(" / ")}: within 0.2 of 1, check not needed`;
};
const TESTS: Test[] = [
  ["z1-zero-screen", "step 1 screen: zero point, poison on, seed 1, 30k [screen]", [...SCREEN, ...E]],
  ["z2-zero-check", "step 1 check: zero point, poison on, 6 seeds, 30k [check]; only if z1 is far from 1", [...CHECK, ...E], zeroFarFromOne],
  ["w1-works-screen", "step 4 screen: works in the base world, harmless poison, seed 1, 30k [screen]", [...SCREEN, ...E, "--poisonDose=0"]],
  ["w2-works-check", "step 4 check: works in the base world, harmless poison, 6 seeds, 30k [check]", [...CHECK, ...E, "--poisonDose=0"]],
  ["w3-works-proof", "step 4 proof: works in the base world, harmless poison, 14 seeds x 200k [proof]", [...PROOF, ...E, "--poisonDose=0"]],
];

mkdirSync(DIR, { recursive: true });
const t0 = performance.now();
for (const [name, what, args, skipIf] of TESTS) {
  const file = `${DIR}/${name}.txt`;
  if (existsSync(file)) { console.log(`skip ${name} (done)`); continue; }
  const why = skipIf?.();
  if (why) { console.log(`skip ${name}: ${why}`); writeFileSync(file, `== ${name}: ${what}\nSKIPPED by gate: ${why}\n`); continue; }
  console.log(`run ${name}: ${what} (${((performance.now() - t0) / 60000).toFixed(0)} min in)`);
  const r = spawnSync(process.execPath, ["src/cli/life-genes.ts", W, `--out=${name}`, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  const out = `== ${name}: ${what}\n${r.stdout}${r.status ? `\nFAILED (exit ${r.status}):\n${r.stderr.slice(-2000)}` : ""}`;
  if (r.status) console.log(`  FAILED, see ${file}`);
  if (!r.status) writeFileSync(file, out);
  else writeFileSync(`${DIR}/${name}.failed.txt`, out);
}
const all = TESTS.map(([n]) => `${DIR}/${n}.txt`).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
writeFileSync(`${DIR}/batch-summary.txt`, all);
console.log(`batch done in ${((performance.now() - t0) / 60000).toFixed(0)} min -> ${DIR}/batch-summary.txt`);

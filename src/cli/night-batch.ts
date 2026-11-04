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
// Night 2026-11-03 (Rey: "any closed branch also worth testing"). Learning-on results to compare against: n1 (old hunter
// senses), n2 (both eyes), q1 (remains), q2 (remains + eyes): all poison on, 14 seeds x 60k. E = both eyes.
const E = ["--hunterEye=4", "--eyeMotion=1"];
const T60 = [S14, "--ticks=60000"], T200 = [S14, "--ticks=200000"];
const TESTS: [string, string, string[]][] = [
  ["m1-forget05", "fix learning: forget 0.05, poison on, eyes (vs n2)", [...T60, ...E, "--forget=0.05"]],
  ["m2-forget05-harmless", "forget 0.05, harmless poison, eyes", [...T60, ...E, "--forget=0.05", "--poisonDose=0"]],
  ["m3-forget2", "forget 0.2 (strong), poison on, eyes", [...T60, ...E, "--forget=0.2"]],
  ["m4-nolearn-eyes", "learning off, poison on, eyes (vs n2)", [...T60, ...E, "--hunterLearn=0"]],
  ["m4b-nolearn-harmless", "control for m7 and m20: learning off, harmless poison, eyes", [...T60, ...E, "--hunterLearn=0", "--poisonDose=0"]],
  ["m5-nolearn-old", "learning off, poison on, old hunter senses (vs n1; hunter eye re-test with m4)", [...T60, "--hunterLearn=0"]],
  ["m6-nolearn-cap", "learning off + dose cap 0.7, poison on, eyes (vs m4)", [...T60, ...E, "--hunterLearn=0", "--hunterDoseCap=0.7"]],
  ["m7-nolearn-remains-harmless", "learning off + remains 500, harmless poison (remains without poison; vs m4b)", [...T60, ...E, "--hunterLearn=0", "--remains=500", "--poisonDose=0"]],
  ["m8-nolearn-remains", "learning off + remains 500, poison on (vs m4; q2 re-test)", [...T60, ...E, "--hunterLearn=0", "--remains=500"]],
  ["m9-genes-strong", "sense genes with strong hunters: harmless poison, learning off, eyes, 200k", [...T200, ...E, "--hunterLearn=0", "--poisonDose=0"]],
  ["m10-genes-poison-nolearn", "sense genes, poison on, learning off, eyes, 200k (both threats)", [...T200, ...E, "--hunterLearn=0"]],
  ["m11-genes-forget", "sense genes, poison on, learning fixed (forget 0.05), eyes, 200k", [...T200, ...E, "--forget=0.05"]],
  ["m12-genes-strong-s15", "m9 on fresh seeds 15-28 (solidify)", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterLearn=0", "--poisonDose=0"]],
  ["m14-nolearn-heye", "learning off, hunter eye only (n3 re-test; vs m5)", [...T60, "--hunterEye=4", "--hunterLearn=0"]],
  ["m15-nolearn-motion", "learning off, prey motion only (n4 re-test; vs m5)", [...T60, "--eyeMotion=1", "--hunterLearn=0"]],
  ["m16-forget-cap", "forget 0.05 + dose cap 0.7, poison on, eyes (vs m1, m6)", [...T60, ...E, "--forget=0.05", "--hunterDoseCap=0.7"]],
  ["m17-forget-old", "forget 0.05, old hunter senses (vs n1, m1)", [...T60, "--forget=0.05"]],
  ["m18-learn005", "hunter learning rate 0.005, no forgetting, poison on, eyes (vs n2, m1)", [...T60, ...E, "--hunterLearn=0.005"]],
  ["m19-nolearn-poison01", "learning off, poison plants 10% (vs m4)", [...T60, ...E, "--hunterLearn=0", "--poison=0.1"]],
  ["m20-preylearn-strong", "prey learn in life (learnRate 0.02, forget 0.002), strong hunters (vs m4b)", [...T60, ...E, "--hunterLearn=0", "--poisonDose=0", "--learnRate=0.02"]],
  ["m21-forget05-s15", "m1 on seeds 15-28 (solidify)", ["--seeds=15-28", "--ticks=60000", ...E, "--forget=0.05"]],
  ["m22-genes-eye8-strong", "sense genes with 8-slice eye, strong hunters, 200k (vs m9)", [...T200, ...E, "--hunterLearn=0", "--poisonDose=0", "--eye=8"]],
];

mkdirSync(DIR, { recursive: true });
const t0 = performance.now();
for (const [name, what, args] of TESTS) {
  const file = `${DIR}/${name}.txt`;
  if (existsSync(file)) { console.log(`skip ${name} (done)`); continue; }
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

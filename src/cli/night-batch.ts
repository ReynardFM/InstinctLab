// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
const W = `--workers=${Math.max(1, Math.floor((availableParallelism() * 3) / 4))}`; // THREE QUARTERS of the threads, this night (Rey 2026-11-11); the standing rule is half
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
  // Finished tests were removed 2026-11-10 (Rey: "delete the code of past tests"); every result is in HISTORY.md and every entry is in
  // git (last at de515af). Finished tests leave their .txt in proto/out/life-genes, so they would be skipped anyway.
  // ---- Night 2026-11-10 (Rey: a): combine what helped. Twice the food (more hunters) + 600k ticks (more time), glow vs BLIND, 14 seeds.
  // Why: glow pick is below blind in ~11 of 14 in every proof, and the gap grows with time (600k check: 0.14 -> 0.23) and with more hunters
  // (food 120: 13 of 14 in the last window). Survival never reached 10 of 14 (best 9 of 14, food 120 evolved).
  // Prediction (before running; low confidence): hunters more with glow in >= 10 of 14 in at least one condition by the end.
  // Kill-if: hunters more in < 8 of 14 in both conditions -> avoiding sick prey does not turn into survival; find out why (open problem).
  // Read: node scripts/pair.mjs gX4-glow-food120-400k bX4-blind-food120-400k ; node scripts/pick-time.mjs gX4-glow-food120-400k bX4-blind-food120-400k
  // Rey 2026-11-11: "use smaller seeds" and "smaller length": 6 seeds x 400k CHECK. Seeds 1-6 at 200k already exist in gB3 / bB3 (hunters more
  // 3 of 6 in both), so only the time past 200k is new; 400k gives 200k of new time.
  // Check-level bar: hunters more with glow in >= 5 of 6 in at least one condition; kill-if < 3 of 6 in both.
  ["gX4-glow-food120-400k", "glow, food 120, same stats, 6 seeds x 400k [check]", ["--seeds=1-6", "--ticks=400000", ...E, "--hunterCue=2", ...SAME, ...FOOD2]],
  ["bX4-blind-food120-400k", "blind control, food 120, same stats, 6 seeds x 400k [check]; pairs with gX4", ["--seeds=1-6", "--ticks=400000", ...E, "--hunterCue=0", ...SAME, ...FOOD2]],
  // ---- Poison sweet spot (Rey 2026-11-11: "lets find the sweet spot"). Flat potency levels, glow vs blind, 6 seeds x 30k [check], same stats.
  // Level = prey poisonDose / hunter dose cap. Today's level (1 / no cap) at this size is gS2 / bS2. Seed-1 screen gave no clear winner.
  // Sweet spot = hunters more with glow AND glow pick below blind, in >= 5 of 6, in at least one condition. Read each pair with pair.mjs.
  ...([["p15", "0.15", "0.28"], ["p30", "0.3", "0.6"], ["p50", "0.5", "1"], ["p75", "0.75", "2"]] as const).flatMap(([n, d, c]): Test[] => [
    [`${n}g-glow-dose${d}`, `glow, poisonDose ${d}, hunter cap ${c}, 6 seeds x 30k [check]`, [...CHECK, ...E, "--hunterCue=2", ...SAME, `--poisonDose=${d}`, `--hunterDoseCap=${c}`]],
    [`${n}b-blind-dose${d}`, `blind, poisonDose ${d}, hunter cap ${c}, 6 seeds x 30k [check]`, [...CHECK, ...E, "--hunterCue=0", ...SAME, `--poisonDose=${d}`, `--hunterDoseCap=${c}`]],
  ]),
  // ---- Night 2026-11-11 extras (Rey: "add more experiments / balancers to test"). All: prey-like breeding, both eyes, 6 x 30k checks first.
  // (1) Hunter balancers at TODAY's poison: real lifespan for frailty + fast poison fade (half-life 25), glow vs blind.
  //     Prediction (low confidence): more hunters than without them (gS2 / bS2), glow pick still below blind.
  ["hB-glow-balancers", "glow + hunterRealLife 1 + hunterPoisonHalfLife 25, today's poison, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--hunterRealLife=1", "--hunterPoisonHalfLife=25"]],
  ["hBb-blind-balancers", "blind + the same balancers, 6 x 30k [check]; pairs with hB", [...CHECK, ...E, "--hunterCue=0", ...SAME, "--hunterRealLife=1", "--hunterPoisonHalfLife=25"]],
  // (2) Does hunter learning pay once a mistake is survivable? Glow at the middle level (dose 0.5, cap 1), learning OFF; pairs with p50g (on).
  ["L50-glow-nolearn", "glow, poisonDose 0.5, cap 1, hunterLearn 0, 6 x 30k [check]; compare with p50g", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterLearn=0"]],
  // (2b) Each balancer alone (glow only), to see which one does the work; compare with hB (both) and gS2 (none).
  ["hR-glow-reallife", "glow + hunterRealLife 1 only, today's poison, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--hunterRealLife=1"]],
  ["hF-glow-fastfade", "glow + hunterPoisonHalfLife 25 only, today's poison, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--hunterPoisonHalfLife=25"]],
  // (2c) More hunters + middle poison: food 120 at dose 0.5 / cap 1, glow vs blind.
  ["f50g-glow-food120-dose0.5", "glow, food 120, poisonDose 0.5, cap 1, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, ...FOOD2, "--poisonDose=0.5", "--hunterDoseCap=1"]],
  ["f50b-blind-food120-dose0.5", "blind, food 120, poisonDose 0.5, cap 1, 6 x 30k [check]; pairs with f50g", [...CHECK, ...E, "--hunterCue=0", ...SAME, ...FOOD2, "--poisonDose=0.5", "--hunterDoseCap=1"]],
  // (2d) Do the four seasons last with middle poison? (With today's poison the world died about every 1,200 ticks: works 0 of 14.)
  ["sE50g-glow-season-dose0.5", "glow, 4 seasons (year 40k), poisonDose 0.5, cap 1, 6 seeds x 80k = 2 years [check]", ["--seeds=1-6", "--ticks=80000", ...E, "--hunterCue=2", ...SAME, "--season=40000", "--poisonDose=0.5", "--hunterDoseCap=1"]],
  ["sE50b-blind-season-dose0.5", "blind, 4 seasons, poisonDose 0.5, cap 1, 6 seeds x 80k [check]; pairs with sE50g", ["--seeds=1-6", "--ticks=80000", ...E, "--hunterCue=0", ...SAME, "--season=40000", "--poisonDose=0.5", "--hunterDoseCap=1"]],
  // (2c) Rey 2026-11-11: two new hunter rules at middle poison (dose 0.5, cap 1; baseline = p50g / p50b), glow vs blind.
  //     hunterBrainNow 1: babies start from the parent's learned brain. Prediction (low confidence): glow pick falls faster than p50g
  //     (learned avoidance is no longer lost at birth); risk: learned noise is inherited too and hunters get worse than p50g.
  //     hunterIdle 0.25: a still hunter pays a quarter of its hunger. Prediction: more hunters in both glow and blind (cheaper life);
  //     the question is whether glow gains MORE than blind. Kill: glow does not beat blind on pick AND hunters in >= 5 of 6.
  ["n50g-glow-dose0.5-brainnow", "glow, dose 0.5, cap 1, brainnow, 6 x 30k [check]; baseline p50g", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1"]],
  ["n50b-blind-dose0.5-brainnow", "blind, dose 0.5, cap 1, brainnow, 6 x 30k [check]; pairs with n50g; baseline p50b", [...CHECK, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1"]],
  ["i50g-glow-dose0.5-idle0.25", "glow, dose 0.5, cap 1, idle0.25, 6 x 30k [check]; baseline p50g", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterIdle=0.25"]],
  ["i50b-blind-dose0.5-idle0.25", "blind, dose 0.5, cap 1, idle0.25, 6 x 30k [check]; pairs with i50g; baseline p50b", [...CHECK, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterIdle=0.25"]],
  ["ni50g-glow-dose0.5-brainnow-idle", "glow, dose 0.5, cap 1, brainnow-idle, 6 x 30k [check]; baseline p50g", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  ["ni50b-blind-dose0.5-brainnow-idle", "blind, dose 0.5, cap 1, brainnow-idle, 6 x 30k [check]; pairs with ni50g; baseline p50b", [...CHECK, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  // (3) Proofs (14 x 200k), only for the arms that pass the sweet-spot gate in their check.
  ...([["p15", "0.15", "0.28"], ["p30", "0.3", "0.6"], ["p50", "0.5", "1"], ["p75", "0.75", "2"]] as const).flatMap(([n, d, c]): Test[] => [
    [`${n}G-glow-dose${d}-proof`, `glow, poisonDose ${d}, cap ${c}, 14 x 200k [proof]; only if ${n}g passed`, [...PROOF, ...E, "--hunterCue=2", ...SAME, `--poisonDose=${d}`, `--hunterDoseCap=${c}`], sweetGate(`${n}g-glow-dose${d}`, `${n}b-blind-dose${d}`)],
    [`${n}B-blind-dose${d}-proof`, `blind, poisonDose ${d}, cap ${c}, 14 x 200k [proof]; pairs with ${n}G`, [...PROOF, ...E, "--hunterCue=0", ...SAME, `--poisonDose=${d}`, `--hunterDoseCap=${c}`], sweetGate(`${n}g-glow-dose${d}`, `${n}b-blind-dose${d}`)],
  ]),
  ["hBG-glow-balancers-proof", "glow + balancers, 14 x 200k [proof]; only if hB passed", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--hunterRealLife=1", "--hunterPoisonHalfLife=25"], sweetGate("hB-glow-balancers", "hBb-blind-balancers")],
  ["hBB-blind-balancers-proof", "blind + balancers, 14 x 200k [proof]; pairs with hBG", [...PROOF, ...E, "--hunterCue=0", ...SAME, "--hunterRealLife=1", "--hunterPoisonHalfLife=25"], sweetGate("hB-glow-balancers", "hBb-blind-balancers")],
];

mkdirSync(DIR, { recursive: true });
const t0 = performance.now();
for (const [name, what, args, skipIf] of TESTS) {
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

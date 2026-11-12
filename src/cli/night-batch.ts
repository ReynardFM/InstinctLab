// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
process.env.LAB_PRIORITY = "normal"; // Rey 2026-11-11 23:42: "c" = 3/4 threads, normal priority for THIS batch. Testing rule: ask Rey before every batch
const W = `--workers=${Math.max(1, Math.floor((availableParallelism() * 3) / 4))}`; // this batch: 3/4 of the threads (Rey 2026-11-11 23:42); ask before every batch
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
  // (2d) Rey 2026-11-11 ("b"): ALL-IN pairs, every helper at once, at dose 0.5 and 0.3. Covers "fixes that only work together".
  //     Pass while the solos fail = the fix is a combination (then remove one rule at a time). Fail = no mix of these rules works.
  ["all50g-glow-dose0.5-all-in", "glow, ALL-IN: dose 0.5, cap 1, food 120, real lifespan, half-life 25, brain now, idle 0.25, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, ...FOOD2, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterRealLife=1", "--hunterPoisonHalfLife=25", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  ["all50b-blind-dose0.5-all-in", "blind, ALL-IN: dose 0.5, cap 1, food 120, real lifespan, half-life 25, brain now, idle 0.25, 6 x 30k [check]; pairs with all50g", [...CHECK, ...E, "--hunterCue=0", ...SAME, ...FOOD2, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterRealLife=1", "--hunterPoisonHalfLife=25", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  ["all30g-glow-dose0.3-all-in", "glow, ALL-IN: dose 0.3, cap 0.6, food 120, real lifespan, half-life 25, brain now, idle 0.25, 6 x 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, ...FOOD2, "--poisonDose=0.3", "--hunterDoseCap=0.6", "--hunterRealLife=1", "--hunterPoisonHalfLife=25", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  ["all30b-blind-dose0.3-all-in", "blind, ALL-IN: dose 0.3, cap 0.6, food 120, real lifespan, half-life 25, brain now, idle 0.25, 6 x 30k [check]; pairs with all30g", [...CHECK, ...E, "--hunterCue=0", ...SAME, ...FOOD2, "--poisonDose=0.3", "--hunterDoseCap=0.6", "--hunterRealLife=1", "--hunterPoisonHalfLife=25", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  // (2e) Rey 2026-11-11 ("c"): the two closest arms of the night, longer: 14 seeds x 100k, glow vs blind. Prediction (low confidence):
  //     the glow pick gap grows with time as in the 400k check. Done: pick lower AND hunters more in >= 10 of 14. Kill: under 8 of 14.
  ["x75g-glow-dose0.75-100k", "glow, dose 0.75, cap 2, 14 x 100k [long check]", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["x75b-blind-dose0.75-100k", "blind, dose 0.75, cap 2, 14 x 100k [long check]; pairs with x75g", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["xni50g-glow-brainnow-idle-100k", "glow, dose 0.5, cap 1, brain now + idle 0.25, 14 x 100k [long check]", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  ["xni50b-blind-brainnow-idle-100k", "blind, same, 14 x 100k [long check]; pairs with xni50g", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.5", "--hunterDoseCap=1", "--hunterBrainNow=1", "--hunterIdle=0.25"]],
  // (2e2) Rey 2026-11-11 ("test poison 0.75 with idling, just that, in proof"): cheap waiting at the closest arm, PROOF 14 x 200k.
  //     Run alone with: node src/cli/night-batch.ts --only=wait75. Baseline x75g / x75b (14 x 100k: both 9 of 14).
  //     Prediction (low confidence): a glow hunter can afford to skip a sick prey, so the glow gain grows. Risk (seen at dose 0.5, 30k):
  //     blind gains as much or more, and prey fall. Done: pick lower AND hunters more in >= 10 of 14. Kill: under 8.
  ["wait75G-glow-dose0.75-idle-proof", "glow, dose 0.75, cap 2, hunterIdle 0.25, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterIdle=0.25"]],
  ["wait75B-blind-dose0.75-idle-proof", "blind, same, 14 x 200k [proof]; pairs with wait75G", [...PROOF, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--hunterIdle=0.25"]],
  // (2h) Rey 2026-11-11 ("that was always the problem, creatures die too fast, balance the energy consumption").
  //     Run alone with: node src/cli/night-batch.ts --only=slow. Measured [seed 1, 12k, dose 0.75, glow; below screen]: a hunter makes a
  //     median of 2 catches in its life (21% none), dies at ~390-465 ticks, 67% starved clean; a prey eats a median of 2 meals, lives 384
  //     ticks, 72% are caught. Problem: with 2 catches per life a hunter cannot learn, and luck beats skill in who breeds.
  //     Fix under test: SLOWER hunters, not cheaper ones: hunger / 4 AND meal / 4. The catch rate a hunter needs is the same (hunger /
  //     meal = 1 per 200 ticks), so prey should not be eaten down as with cheap waiting; but a body's store lasts 4x longer and a baby
  //     costs ~5 catches instead of ~1.2. Poison harm rides on hunger, so the same dose costs 1/4: the second pair uses dose x4.
  //     Prediction (low confidence): catches per life ~8, fewer die-outs, glow pick gap wider than x75 (0.58 vs 0.71). Risk: 4x fewer
  //     hunter generations in 100k, so evolution is slower. Done: works >= 5 of 6 AND both in >= 5 of 6. Kill: prey fall as with waiting.
  ["slow75g-glow-slow-hunters-dose0.75", "glow, hunters burn 1/4 and a meal gives 1/4, dose 0.75, cap 2 (same dose), 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--hunterHunger=0.000625", "--hunterMeal=0.125", "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["slow75b-blind-slow-hunters-dose0.75", "blind, hunters burn 1/4 and a meal gives 1/4, dose 0.75, cap 2 (same dose), 6 x 100k [long check]; pairs with slow75g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--hunterHunger=0.000625", "--hunterMeal=0.125", "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["slow3g-glow-slow-hunters-dose3", "glow, hunters burn 1/4 and a meal gives 1/4, dose 3, cap 8 (dose x4 = the same energy cost per mistake as before), 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--hunterHunger=0.000625", "--hunterMeal=0.125", "--poisonDose=3", "--hunterDoseCap=8"]],
  ["slow3b-blind-slow-hunters-dose3", "blind, hunters burn 1/4 and a meal gives 1/4, dose 3, cap 8 (dose x4 = the same energy cost per mistake as before), 6 x 100k [long check]; pairs with slow3g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--hunterHunger=0.000625", "--hunterMeal=0.125", "--poisonDose=3", "--hunterDoseCap=8"]],
  // (2k) Rey 2026-11-11 23:00 ("add resistance gene, make it useful by incorporating season, hunter will default slow").
  //     Run alone with: node src/cli/night-batch.ts --only=se. Slow hunters are now the ENGINE default (no flag). resistGene is now a share
  //     of the body's burn (0.3 = +30% at full resistance; the same cost for prey as the old 0.0005, far lighter for slow hunters).
  //     Problem: with steady poison resistance only climbs slowly (0.4-0.5 at 100k) and nothing shows what it is FOR. Mechanism: in the
  //     poison season (twice the poison plants) resistant prey keep eating and breeding; in the clean season (no poison plants) resistance
  //     is pure cost. Prediction (low confidence): prey resistance is higher at the end of poison seasons than at the end of clean ones,
  //     and prey are more numerous with the gene than without it (se0G) in the poison seasons.
  //     Tries [seed 1, 16k, year 8k, below screen]: with the farm seasons prey swing 22 (foraging) to 140 (farm) and both sides die out
  //     (9 die-outs); without the farm prey stay at 89-163, sick share swings 12% / 42% / 19% / 39% (6 die-outs). So the main test has no
  //     farm (new switch seasonFarm 0); the four-season world is run next to it.
  //     Done: works >= 5 of 6 AND prey resistance above the no-poison control in >= 5 of 6. Kill: works under 3 of 6.
  ["seRG-glow-season-resist", "glow, poison seasons (no farm), resistance gene, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3"]],
  ["seRB-blind-season-resist", "blind, same; pairs with seRG, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3"]],
  ["se0G-glow-season-nogene", "CONTROL no gene: glow, poison seasons (no farm), dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0"]],
  ["seRn-glow-season-resist-nopoison", "DRIFT CONTROL: glow, seasons, gene, NO poison plants, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3", "--poison=0"]],
  ["seRflat-glow-noseason-resist", "CONTROL no seasons: glow, gene, steady poison, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3"]],
  ["seFRG-glow-4season-resist", "glow, FOUR seasons with farm (as built 2026-11-09), resistance gene, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--resistGene=0.3"]],
  ["seF0G-glow-4season-nogene", "CONTROL no gene: glow, four seasons with farm, dose 0.75, cap 2, slow hunters (default), 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000"]],
  // (2l) Rey 2026-11-11 23:34 ("test the resistance in 2 different ways, stomach and scattered farms, add half the number of seeds
  //     with both"). The farm seasons boom and bust (prey 22 <-> 140, one seed). Nature's answers (Huffaker's mites 1958; migration
  //     review 2019): many small patches, and hunters that fill up. Stomach 8 = a full hunter cannot catch; seasonFarm 8 = eight small
  //     farms with the area of the two big ones. Each way has a no-gene twin so the gene's effect can be read; "both" has 3 seeds.
  //     Baselines: seFRG / seF0G (2 big farms, no stomach). Prediction (low confidence): fewer die-outs than seFRG in both ways; prey
  //     resistance above the no-poison control (seRn). Done: works >= 5 of 6 (both: 3 of 3). Kill: die-outs not below seFRG.
  ["seStG-glow-4season-stomach-resist", "glow, four seasons (2 farms) + STOMACH 8, resistance gene, dose 0.75, cap 2, slow hunters, 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--digest=8", "--resistGene=0.3"]],
  ["seSt0-glow-4season-stomach-nogene", "CONTROL no gene: glow, four seasons (2 farms) + stomach 8, dose 0.75, cap 2, slow hunters, 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--digest=8"]],
  ["seScG-glow-4season-scattered-resist", "glow, four seasons with 8 SCATTERED farms, resistance gene, dose 0.75, cap 2, slow hunters, 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=8", "--resistGene=0.3"]],
  ["seSc0-glow-4season-scattered-nogene", "CONTROL no gene: glow, four seasons with 8 scattered farms, dose 0.75, cap 2, slow hunters, 6 x 160k = 4 years [long check]", ["--seeds=1-6", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=8"]],
  ["seBothG-glow-4season-stomach-scattered-resist", "glow, four seasons, STOMACH 8 + 8 SCATTERED farms, resistance gene (half the seeds), dose 0.75, cap 2, slow hunters, 3 x 160k = 4 years [long check]", ["--seeds=1-3", "--ticks=160000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=8", "--digest=8", "--resistGene=0.3"]],
  // Testing rule: proofs of the main season + resistance test (14 x 200k = 5 years), only if seRG works in >= 5 of 6.
  ["seRGp-glow-season-resist-proof", "glow, poison seasons (no farm), resistance gene, 14 x 200k [proof]; only if seRG passed", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3"], passGate("seRG-glow-season-resist", 5)],
  ["seRBp-blind-season-resist-proof", "blind, same, 14 x 200k [proof]; pairs with seRGp", [...PROOF, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3"], passGate("seRG-glow-season-resist", 5)],
  ["seRnp-glow-season-resist-nopoison-proof", "DRIFT CONTROL for the proof: no poison plants, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--season=40000", "--seasonFarm=0", "--resistGene=0.3", "--poison=0"], passGate("seRG-glow-season-resist", 5)],
  // (2j) Rey 2026-11-11 16:58 ("revert the prey, but keep slow hunter. Now retest slow hunter as the default, against all that work").
  //     Run alone with: node src/cli/night-batch.ts --only=sh. SLOW hunters (hunger / 4, meal / 4) are the base of every test here; prey are
  //     normal (preySlow was deleted). On top, one at a time, what worked at check level: dose 0.75 (now a PROOF), dose 3 (lowest pick),
  //     the stomach at 5 and 8, the resistance gene (with its no-poison control).
  //     Evidence so far [6 x 100k]: slow hunters work 6 / 6 of 6, hunter die-outs 1.7 per run (fast: 6.3), pick 0.50 vs blind 0.60.
  //     Prediction (low confidence): the proof keeps "works" >= 10 of 14 and pick lower in >= 10 of 14; "more hunters" stays a coin flip.
  //     Caveats: the stomach's speed is a multiple of the (now 4x smaller) hunger; the resistance upkeep 0.0005 is 80% of a slow hunter's
  //     hunger (it was 20%), so hunter resistance is expected to stay low.
  // Rey 2026-11-11 17:05 ("I mean the old engine scenario, we will start incorporating it into the engine"): the four OLD proof
  // scenarios again, same arguments, same seeds, same length, plus SLOW hunters. Each pairs with its old result file (no rerun needed):
  // w3-works-proof (engine breeding, harmless poison: works 14 / 14), wS3-works-same (prey-like breeding: 14 / 13),
  // gS3-glow-same and bS3-blind-same (today's full poison, dose 1, no cap). Done: works in at least as many seeds as the old run.
  // Kill: works in fewer seeds. Unknown: engine breeding (birth at 1.4 energy, chance 0.03) with meals of 0.125 may breed too slowly.
  ["shW3-works-engine-breeding", "OLD SCENARIO w3 + SLOW hunters: works, harmless poison, engine breeding, 14 x 200k [proof]", [...PROOF, ...E, "--poisonDose=0", ...SLOW]],
  ["shWS3-works-same-breeding", "OLD SCENARIO wS3 + SLOW hunters: works, harmless poison, prey-like breeding, 14 x 200k [proof]", [...PROOF, ...E, "--poisonDose=0", ...SAME, ...SLOW]],
  ["shGS3-glow-same-fullpoison", "OLD SCENARIO gS3 + SLOW hunters: glow, full poison (dose 1), prey-like breeding, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, ...SLOW]],
  ["shBS3-blind-same-fullpoison", "OLD SCENARIO bS3 + SLOW hunters: blind, same, 14 x 200k [proof]; pairs with shGS3", [...PROOF, ...E, "--hunterCue=0", ...SAME, ...SLOW]],
  ["sh75G-glow-slowbase-dose0.75-proof", "glow, SLOW hunters, dose 0.75, cap 2, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["sh75B-blind-slowbase-dose0.75-proof", "blind, SLOW hunters, dose 0.75, cap 2, 14 x 200k [proof]; pairs with sh75G", [...PROOF, ...E, "--hunterCue=0", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2"]],
  ["sh3G-glow-slowbase-dose3", "glow, SLOW hunters, dose 3, cap 8, 14 x 100k [long check]", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poisonDose=3", "--hunterDoseCap=8"]],
  ["sh3B-blind-slowbase-dose3", "blind, SLOW hunters, dose 3, cap 8, 14 x 100k [long check]; pairs with sh3G", ["--seeds=1-14", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, ...SLOW, "--poisonDose=3", "--hunterDoseCap=8"]],
  ["shGut5G-glow-slowbase-digest5", "glow, SLOW hunters, dose 0.75, stomach digest 5, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=5"]],
  ["shGut5B-blind-slowbase-digest5", "blind, SLOW hunters, dose 0.75, stomach digest 5, 6 x 100k [long check]; pairs with shGut5G", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=5"]],
  ["shGut8G-glow-slowbase-digest8", "glow, SLOW hunters, dose 0.75, stomach digest 8, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=8"]],
  ["shGut8B-blind-slowbase-digest8", "blind, SLOW hunters, dose 0.75, stomach digest 8, 6 x 100k [long check]; pairs with shGut8G", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=8"]],
  ["shResG-glow-slowbase-resist", "glow, SLOW hunters, dose 0.75, resistGene 0.0005, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.0005"]],
  ["shResB-blind-slowbase-resist", "blind, SLOW hunters, dose 0.75, resistGene 0.0005, 6 x 100k [long check]; pairs with shResG", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, ...SLOW, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.0005"]],
  ["shRes0-glow-slowbase-resist-nopoison", "DRIFT CONTROL: glow, SLOW hunters, no poison plants, resistGene 0.0005, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, ...SLOW, "--poison=0", "--resistGene=0.0005"]],
  // (2g) Rey 2026-11-11 ("a digest bar ... works for prey and hunter"; poison seeps in; "add full, digestion balanced like real nature"):
  //     a stomach with a "how full" input, digesting digest x what the body burns, at the closest arm (dose 0.75).
  //     Run alone with: node src/cli/night-batch.ts --only=gut. Problem: a hunter is search-limited (1 meal per ~200 ticks, 30 ticks rest),
  //     so any prey is worth taking and skipping a sick one costs a meal. Mechanism: a full stomach blocks the next catch, so a sick prey
  //     wastes the slot a clean one could fill (optimal diet: be choosy when handling, not searching, is the limit).
  //     digest 3 = nature-like (gorge and fast); 5 and 8 = looser. 10k tries on seed 1 [below screen]: 3 -> prey 25, hunters 2.8
  //     (no stomach: 59, 11.3); 5 -> 19 / 3.3; 8 -> 55 / 9.6. One seed is noise; these runs decide.
  //     Prediction (low confidence): where the world still works, the glow pick gap is wider than x75 (0.58 vs 0.71). Risk: at 3 the
  //     world starves. Done: works >= 5 of 6 AND both in >= 5 of 6. Kill: works under 3 of 6, or no wider pick gap.
  ["gut3g-glow-dose0.75-digest3", "glow, dose 0.75, cap 2, stomach: digest 3 x burn, 6 x 100k [long check]; baseline x75g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=3"]],
  ["gut3b-blind-dose0.75-digest3", "blind, dose 0.75, cap 2, stomach: digest 3 x burn, 6 x 100k [long check]; pairs with gut3g; baseline x75b", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=3"]],
  ["gut5g-glow-dose0.75-digest5", "glow, dose 0.75, cap 2, stomach: digest 5 x burn, 6 x 100k [long check]; baseline x75g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=5"]],
  ["gut5b-blind-dose0.75-digest5", "blind, dose 0.75, cap 2, stomach: digest 5 x burn, 6 x 100k [long check]; pairs with gut5g; baseline x75b", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=5"]],
  ["gut8g-glow-dose0.75-digest8", "glow, dose 0.75, cap 2, stomach: digest 8 x burn, 6 x 100k [long check]; baseline x75g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=8"]],
  ["gut8b-blind-dose0.75-digest8", "blind, dose 0.75, cap 2, stomach: digest 8 x burn, 6 x 100k [long check]; pairs with gut8g; baseline x75b", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--digest=8"]],
  // (2f) Rey 2026-11-11: inborn resistance gene (upkeep 0.0005) + rising potency (10% per 1,000 ticks over the 20% line), base dose 0.15.
  //     Problem: flat poison is deadly per mistake or harmless (all-in). Mechanism: a side that leans on poison meets stronger poison; glow
  //     hunters can stay under the line by avoiding, blind ones cannot. Prediction (low confidence): blind hunters end with higher potency
  //     and resistance than glow hunters; resistance with poison is above the no-poison drift control (drift alone gave ~0.14 at 12k).
  //     Done: both in >= 5 of 6. Kill: resistance the same with and without poison.
  ["rPg-glow-resist-potency", "glow, dose 0.15, resistGene 0.0005, potencyRise 0.1, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.15", "--resistGene=0.0005", "--potencyRise=0.1"]],
  ["rPb-blind-resist-potency", "blind, same, 6 x 100k [long check]; pairs with rPg", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.15", "--resistGene=0.0005", "--potencyRise=0.1"]],
  ["rP0-glow-resist-nopoison", "DRIFT CONTROL: glow, no poison plants, resistGene 0.0005, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poison=0", "--resistGene=0.0005"]],
  ["rPf-glow-resist-free", "COST CONTROL: glow, dose 0.15, resistGene almost free (0.000001), potencyRise 0.1, 6 x 100k [long check]", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.15", "--resistGene=0.000001", "--potencyRise=0.1"]],
  ["rGg-glow-resist-dose0.75", "glow, dose 0.75, cap 2, resistGene 0.0005, no rising potency, 6 x 100k [long check]; baseline x75g", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.0005"]],
  ["rGb-blind-resist-dose0.75", "blind, same, 6 x 100k [long check]; pairs with rGg", ["--seeds=1-6", "--ticks=100000", ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.0005"]],
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

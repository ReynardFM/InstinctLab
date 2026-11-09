// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
const W = `--workers=${Math.max(1, Math.floor(availableParallelism() / 2))}`; // half the threads (standing rule; Rey 2026-11-05: back from all-minus-1)
const S14 = "--seeds=1-14";
// Night 2026-11-04 (Rey: "prep for overnight batch"). Older nights (m1-m22, n/q tests) are in git at 9942908: they used RAW hunter
// learning, and hunters now learn relative + forget by default, so re-running them would answer a different question.
// DEFAULTS THAT CHANGE BEHAVIOUR (all runs below): hunterLearn 0.02, hunterCue 1 (speed), relativeReward 1 + forget 0.002 (now also for hunters).
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
// c3 / cs3 gate: run the proof only if c1's pick is below cs1's in >= 5 of 6 paired seeds, in either condition
const capGate = (): string | null => {
  const a = `${DIR}/c1-glowcap-check.json`, b = `${DIR}/cs1-glowshufcap-check.json`;
  if (!existsSync(a) || !existsSync(b)) return "c1 / cs1 missing";
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  const best = Math.max(...[0, 1].map((c) => A.filter((r: { cond: number; seed: number; m: { pick: number } }) => r.cond === c &&
    B.some((q: { cond: number; seed: number; m: { pick: number } }) => q.cond === c && q.seed === r.seed && r.m.pick < q.m.pick)).length));
  return best >= 5 ? null : `c1 pick below cs1 in only ${best} of 6 seeds (need 5): proof not run`;
};
// Same-stats night (Rey 2026-11-08: a). Hunters breed like prey: any age, energy 1.2, whenever full (fertility still falls to 0 at 6000).
const SAME = ["--hunterMature=0", "--hunterBirth=1.2", "--hunterBirthChance=1"];
// gate for the poison runs: the base world must still work under the new stats (>= 10 of 14 in either condition)
const sameWorks = (): string | null => {
  const f = `${DIR}/wS3-works-same.json`;
  if (!existsSync(f)) return "wS3 missing";
  const A = JSON.parse(readFileSync(f, "utf8")) as { cond: number; m: { works: boolean } }[];
  const best = Math.max(...[0, 1].map((c) => A.filter((r) => r.cond === c && r.m.works).length));
  return best >= 10 ? null : `base world under same stats works in only ${best} of 14: poison runs not run`;
};
// gate: the base world must work (>= 10 of 14 in either condition) in the named works run before its poison runs start
const worksGate = (name: string) => (): string | null => {
  const f = `${DIR}/${name}.json`;
  if (!existsSync(f)) return `${name} missing`;
  const A = JSON.parse(readFileSync(f, "utf8")) as { cond: number; m: { works: boolean } }[];
  const best = Math.max(...[0, 1].map((c) => A.filter((r) => r.cond === c && r.m.works).length));
  return best >= 10 ? null : `${name}: base world works in only ${best} of 14: poison runs not run`;
};
const FOOD2 = ["--food=120"]; // "bigger world" (Rey 2026-11-09: b): twice the food on the same 800 x 600 map (the map size is not a setting)
const TESTS: Test[] = [
  ["z1-zero-screen", "step 1 screen: zero point, poison on, seed 1, 30k [screen]", [...SCREEN, ...E]],
  ["z2-zero-check", "step 1 check: zero point, poison on, 6 seeds, 30k [check]; only if z1 is far from 1", [...CHECK, ...E], zeroFarFromOne],
  ["w1-works-screen", "step 4 screen: works in the base world, harmless poison, seed 1, 30k [screen]", [...SCREEN, ...E, "--poisonDose=0"]],
  ["w2-works-check", "step 4 check: works in the base world, harmless poison, 6 seeds, 30k [check]", [...CHECK, ...E, "--poisonDose=0"]],
  // Control for the zero point (Rey 2026-11-04 "add to the batch"): hunters cannot see the sick cue (old senses, hunterCue 0; prey keep eyeMotion 1).
  // Prediction (written before running): blind pick lands near its own 200px zero (within ~0.1), or above it because sick prey are slow and stay in reach.
  // If blind pick is far BELOW its zero, the zero point is not a valid floor (something besides sensing lowers pick).
  ["zb1-blind-check", "zero-point control: blind hunters (no speed cue), poison on, 6 seeds, 30k [check]", [...CHECK, "--eyeMotion=1", "--hunterCue=0"]],
  ["w3-works-proof", "step 4 proof: works in the base world, harmless poison, 14 seeds x 200k [proof]", [...PROOF, ...E, "--poisonDose=0"]],
  // Zero-point repair (Rey 2026-11-05: a). Same seeds/ticks as z2 and zb1 (counting only, so same runs) plus circles of 25 px and 12 px (catch reach is 6).
  // Prediction (before running): zero falls as the circle shrinks, about 0.5-0.7 at 12 px; blind pick within ~0.15 of its own 12px zero.
  // Kill-if: blind 12px zero stays > 0.3 above blind pick in >= 4 of 6 seeds -> place is not the cause.
  ["z5-zero-circles", "zero point with 25 px and 12 px circles, poison on, 6 seeds, 30k [check]; same runs as z2", [...CHECK, ...E]],
  ["zb5-blind-circles", "blind-hunter control with 25 px and 12 px circles, poison on, 6 seeds, 30k [check]; same runs as zb1", [...CHECK, "--eyeMotion=1", "--hunterCue=0"]],
  // ---- Night 2026-11-06 (Rey: "test glow and then gradient, make it long night batch"). Poison on (dose 1), both eyes, defaults above.
  // rules.hunterCue: 2 glow, 3 glow shuffled (control), 4 scent, 5 scent shuffled (control). Read pairs with: node scripts/pair.mjs <real> <control>
  // Bar (Rey): pick lower AND hunters alive higher in the real run in >= 10 of 14 paired seeds, per condition.
  // Cue check before running (scripts/cue-check.mjs, seed 1-2, 8k): glow AUC 1.00, shuffled 0.52; scent 0.89 / 0.97, shuffled 0.37 / 0.46
  // (shuffled scent still maps prey density, so it is not a clean no-cue control).
  // Prediction (before running; unverified): glow pick lower than shuffled in >= 10 of 14; survival gain unsure (one poisoned catch kills,
  // so only selection can build avoidance; prior work: rare toxic prey kill naive predators before avoidance spreads, Sword 1999).
  // Scent weaker than glow. Kill-if: glow pick lower in < 8 of 14 -> a clean cue is not enough; the bottleneck is selection, not sensing.
  ["g1-glow-screen", "glow cue, seed 1, 30k [screen]", [...SCREEN, ...E, "--hunterCue=2"]],
  ["g2-glow-check", "glow cue, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=2"]],
  ["gs2-glowshuf-check", "shuffled glow (control), 6 seeds, 30k [check]; pairs with g2", [...CHECK, ...E, "--hunterCue=3"]],
  ["g3-glow-proof", "glow cue, 14 seeds x 200k [proof]", [...PROOF, ...E, "--hunterCue=2"]],
  ["gs3-glowshuf-proof", "shuffled glow (control), 14 seeds x 200k [proof]; pairs with g3", [...PROOF, ...E, "--hunterCue=3"]],
  ["s1-scent-screen", "scent cue, seed 1, 30k [screen]", [...SCREEN, ...E, "--hunterCue=4"]],
  ["s2-scent-check", "scent cue, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=4"]],
  ["ss2-scentshuf-check", "shuffled scent (control), 6 seeds, 30k [check]; pairs with s2", [...CHECK, ...E, "--hunterCue=5"]],
  ["s3-scent-proof", "scent cue, 14 seeds x 200k [proof]", [...PROOF, ...E, "--hunterCue=4"]],
  ["ss3-scentshuf-proof", "shuffled scent (control), 14 seeds x 200k [proof]; pairs with s3", [...PROOF, ...E, "--hunterCue=5"]],
  // replication on fresh seeds 15-28 (guards against the seed range), glow then scent
  ["g4-glow-s15", "glow cue, seeds 15-28 x 200k [proof]", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=2"]],
  ["gs4-glowshuf-s15", "shuffled glow, seeds 15-28 x 200k [proof]; pairs with g4", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=3"]],
  ["s4-scent-s15", "scent cue, seeds 15-28 x 200k [proof]", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=4"]],
  ["ss4-scentshuf-s15", "shuffled scent, seeds 15-28 x 200k [proof]; pairs with s4", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=5"]],
  // ---- 2026-11-06 (Rey: b, "cap the hunter dose at 1"). Poison hurts hunters like a pellet hurts prey, not as a death sentence.
  // Why the cap: a caught prey passes its WHOLE level through the hunter's age frailty: median sick prey 2.83 x hunter multiplier 3.72
  // = about 10 units (dose-check.mjs, seed 1). Cap fixed up front at 1 (an adult prey's pellet), not tuned after.
  // Prediction (before running): glow pick lower than shuffled in >= 5 of 6, and below its own 12px zero. Kill-if: lower in <= 3 of 6.
  // Risk: at 1 the extra hunger is about 0.0025 x 1 x 721 = 1.8 energy over the poison's life, so a hunter may still starve.
  ["c1-glowcap-check", "glow + hunterDoseCap 1, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=2", "--hunterDoseCap=1"]],
  ["cs1-glowshufcap-check", "shuffled glow + hunterDoseCap 1, 6 seeds, 30k [check]; pairs with c1", [...CHECK, ...E, "--hunterCue=3", "--hunterDoseCap=1"]],
  ["c3-glowcap-proof", "glow + cap 1, 14 x 200k [proof]; only if c1 beats cs1 on pick in >= 5 of 6", [...PROOF, ...E, "--hunterCue=2", "--hunterDoseCap=1"], capGate],
  ["cs3-glowshufcap-proof", "shuffled glow + cap 1, 14 x 200k [proof]; pairs with c3", [...PROOF, ...E, "--hunterCue=3", "--hunterDoseCap=1"], capGate],
  // ---- Night 2026-11-08 (Rey: a). Same breeding stats as prey, passed as flags (defaults unchanged tonight; golden untouched).
  // Control is BLIND (hunterCue 0), not the shuffled glow, which hurt hunters ~30% (6 seeds, 2026-11-06).
  // Prediction (before running; unverified): wS3 works in >= 12 of 14. Glow pick below blind in >= 10 of 14 in at least one condition:
  // a coin-flip guess. Kill-if: glow pick below blind in < 8 of 14 in both conditions -> more hunter generations are not enough.
  // Read: node scripts/pair.mjs gS3-glow-same bS3-blind-same (and gS2/bS2, gS4/bS4); also the zero-point lines (pick vs 12px zero).
  ["wS3-works-same", "works, harmless poison, same breeding stats, 14 x 200k [proof]", [...PROOF, ...E, "--poisonDose=0", ...SAME]],
  ["gS2-glow-same", "glow, poison on, same stats, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME], sameWorks],
  ["bS2-blind-same", "blind (control), poison on, same stats, 6 seeds, 30k [check]; pairs with gS2", [...CHECK, ...E, "--hunterCue=0", ...SAME], sameWorks],
  ["gS3-glow-same", "glow, poison on, same stats, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME], sameWorks],
  ["bS3-blind-same", "blind (control), poison on, same stats, 14 x 200k [proof]; pairs with gS3", [...PROOF, ...E, "--hunterCue=0", ...SAME], sameWorks],
  ["gS4-glow-same-s15", "glow, same stats, seeds 15-28 x 200k [proof]", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=2", ...SAME], sameWorks],
  ["bS4-blind-same-s15", "blind, same stats, seeds 15-28 x 200k [proof]; pairs with gS4", ["--seeds=15-28", "--ticks=200000", ...E, "--hunterCue=0", ...SAME], sameWorks],
  // ---- Night 2026-11-09 (Rey: "A and b"). Why: prey and hunters pay about the same per mistake (87% vs 82-97% dead within 300 ticks),
  // but prey get ~3,150 lives per 20k ticks and hunters 527 (prey-like breeding): hunters adapt slower because they are fewer.
  // (a) TIME: glow vs blind for 600k ticks, 6 seeds, same breeding stats. Read: node scripts/pick-time.mjs gL-glow-600k bL-blind-600k
  //     Prediction (before running; low confidence): glow pick keeps falling across windows and is below blind in >= 5 of 6 in the last
  //     window (handed out). Kill-if: the glow-blind gap in the last window is no bigger than in the 100-200k window -> time alone is not enough.
  // (b) NUMBERS: twice the food. Screen (seed 1, 12k): prey 137 vs 77, hunters 33 vs 17, about 2x the hunter lives per tick.
  //     wB3 re-measures "works"; glow vs blind run only if it passes. Prediction: works >= 10 of 14; glow pick below blind in >= 11 of 14 (handed out).
  ["gL-glow-600k", "(a) glow, same stats, 6 seeds x 600k [check, long]", ["--seeds=1-6", "--ticks=600000", ...E, "--hunterCue=2", ...SAME]],
  ["bL-blind-600k", "(a) blind control, same stats, 6 seeds x 600k [check, long]; pairs with gL", ["--seeds=1-6", "--ticks=600000", ...E, "--hunterCue=0", ...SAME]],
  ["wB3-works-food120", "(b) works, harmless poison, same stats, food 120, 14 x 200k [proof]", [...PROOF, ...E, "--poisonDose=0", ...SAME, ...FOOD2]],
  ["gB2-glow-food120", "(b) glow, food 120, same stats, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, ...FOOD2], worksGate("wB3-works-food120")],
  ["bB2-blind-food120", "(b) blind control, food 120, 6 seeds, 30k [check]; pairs with gB2", [...CHECK, ...E, "--hunterCue=0", ...SAME, ...FOOD2], worksGate("wB3-works-food120")],
  ["gB3-glow-food120", "(b) glow, food 120, same stats, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, ...FOOD2], worksGate("wB3-works-food120")],
  ["bB3-blind-food120", "(b) blind control, food 120, 14 x 200k [proof]; pairs with gB3", [...PROOF, ...E, "--hunterCue=0", ...SAME, ...FOOD2], worksGate("wB3-works-food120")],
  // ---- Seasons, extreme swing (Rey 2026-11-09: "make extreme swings"): a 20,000-tick year: 10k with NO poison plants, then 10k with
  // twice the usual. Year length fixed up front: a half-year is about 15-20 hunter or prey lifetimes (prior work: goals that switch
  // about every 20 generations sped up evolution, Kashtan & Alon 2005). Screen (seed 1, 30k): clean season sick prey 1%, hunters 42;
  // poison season sick prey 22%, hunters 16; die-outs 17 (no season: 6). Same breeding stats, poison dose 1, both eyes.
  // Question: is the glow-vs-blind pick gap bigger with seasons than without (gS3 / bS3: 0.52 vs 0.64, 11 of 14)?
  // Prediction (before running; low confidence): the gap is bigger (pick lower in >= 11 of 14, handed out) because exposure doubles in the
  // poison season. Kill-if: pick lower in < 8 of 14 in both conditions, or the world collapses (works < 5 of 14).
  ["gE2-glow-season", "glow, season 20k, same stats, 6 seeds, 30k [check]", [...CHECK, ...E, "--hunterCue=2", ...SAME, "--season=20000"]],
  ["bE2-blind-season", "blind control, season 20k, 6 seeds, 30k [check]; pairs with gE2", [...CHECK, ...E, "--hunterCue=0", ...SAME, "--season=20000"]],
  ["gE3-glow-season", "glow, season 20k, same stats, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--season=20000"]],
  ["bE3-blind-season", "blind control, season 20k, 14 x 200k [proof]; pairs with gE3", [...PROOF, ...E, "--hunterCue=0", ...SAME, "--season=20000"]],
  // PARKED 2026-11-05 (Rey: "just the important ones"; kept for later, not run). Move a line up into TESTS to run it:
  //   ["z3-zero-proof", "zero point at proof size, poison on, 14 seeds x 200k [proof], pairs with zb3 and w3 seeds", [...PROOF, ...E]],
  //   ["zb3-blind-proof", "zero-point control at proof size: blind hunters, poison on, 14 seeds x 200k [proof]", [...PROOF, "--eyeMotion=1", "--hunterCue=0"]],
  //   // Controls for the Q2 merge (Rey 2026-11-04): paired seeds 1-14 with w3 (new default: relative + forget). NOT tuning, NOT counted as wins.
  //   // Prediction (before running): hunters in w3 ~ w6 (learning off), both well above w5 (raw learning; before: 27.8 -> 13.5 with harmless poison, 6/6).
  //   // Kill-if: w3 hunters < 0.75 x w6 hunters in >= 10 of 14 paired seeds -> the new default still harms; record as an open problem, do not tune.
  //   ["w5-works-raw-learning", "control: raw hunter learning (relativeReward 0, forget 0), harmless poison, 14 x 200k [proof]; pairs with w3", [...PROOF, ...E, "--poisonDose=0", "--relativeReward=0", "--forget=0"]],
  //   ["w6-works-learning-off", "control: hunter learning off, harmless poison, 14 x 200k [proof]; pairs with w3", [...PROOF, ...E, "--poisonDose=0", "--hunterLearn=0"]],
  //   ["w4-works-seeds15-28", "works replication on fresh seeds 15-28, harmless poison, 200k [proof]: guards against the seed range", ["--seeds=15-28", "--ticks=200000", ...E, "--poisonDose=0"]],
  //   ["z4-zero-seeds15-28", "zero point replication on fresh seeds 15-28, poison on, 200k [proof]", ["--seeds=15-28", "--ticks=200000", ...E]],
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

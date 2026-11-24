// Overnight batch (Rey 2026-11-02, AFK): runs life-genes.ts tests one after another on half the threads.
// Each summary goes to proto/out/life-genes/<name>.txt; a test whose .txt exists is skipped (safe to restart).
// All summaries are joined in proto/out/life-genes/batch-summary.txt.
//   node src/cli/night-batch.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "proto/out/life-genes";
process.env.LAB_PRIORITY = "normal"; // Rey 2026-11-24 13:40: 3/4 threads, normal priority for the --only=fixfast,fixslow14,swing batch (he is out). Reset to half / low after. Testing rule 4: ask Rey before every batch.
const W = `--workers=${Math.max(1, Math.floor((availableParallelism() * 3) / 4))}`; // this batch: 3/4 of the threads (Rey 2026-11-24 13:40)
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
  // (4a) Rey 2026-11-19 ("judge poison by nature"): the nature bar (CLAUDE.md), one proof. Run alone with: node src/cli/night-batch.ts --only=nat.
  //     Slow hunters (default), prey-like breeding, both eyes, dose 0.75 / cap 2, steady poison, resistance gene 0.3. Glow vs blind
  //     (predator response by avoidance) and a no-poison control (prey and hunter resistance by drift alone). Same seeds 1-14 in all three.
  //     Evidence so far [6 x 200k, rmpFlat]: works 6 / 6, prey resistance 0.60 / 0.48 vs drift 0.19 / 0.24, hunter resistance 0.35 / 0.19.
  //     Prediction (low confidence): (1) and (2) pass; (3) passes by the resistance route, not by avoidance (slow hunters dodged in only
  //     6-7 of 14 in sh75); (4) passes (hunters per prey ~0.2).
  ["natG-glow-resist-proof", "NATURE BAR: glow, gene 0.3, 14 x 200k [proof]", [...PROOF, ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2"]],
  ["natB-blind-resist-proof", "NATURE BAR: blind, same; pairs with natG [proof]", [...PROOF, ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=0"]],
  ["nat0-glow-resist-nopoison-proof", "NATURE BAR: drift control, glow, gene 0.3, NO poison plants [proof]", [...PROOF, ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poison=0"]],
  // (4b) Rey 2026-11-19 ("b": the longer glow test). Run alone with: node src/cli/night-batch.ts --only=nat4. The nature-bar glow world
  //     and its no-poison control, same seeds, 400k instead of 200k (no new rule). At 200k the glow world missed by one seed twice:
  //     hunter resistance > control 9 of 14 (handed out), prey resistance > control 9 of 14 (evolved), both still rising at the end
  //     (rule 7: "too slow to show"). The blind twin is not rerun: avoidance (3a) was 5 of 14 handed out, far from 10.
  //     Prediction (low confidence): both misses reach >= 10 of 14 at 400k. Done: all four nature points hold in the glow world in both
  //     conditions (3 by either route). Kill: either miss stays <= 9 of 14 (then the glow world's split between routes is real, not slow).
  ["nat4G-glow-resist-400k", "NATURE BAR, longer: glow, gene 0.3, 14 x 400k [proof]", ["--seeds=1-14", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2"]],
  ["nat40-glow-resist-nopoison-400k", "NATURE BAR, longer: drift control, NO poison plants, 14 x 400k [proof]", ["--seeds=1-14", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poison=0"]],
  // (4c) Rey 2026-11-20 ("make dodge and poison resistance into 2 paths: one where the poison gets stronger and stronger, so we
  //     expect more resistance; dodge will be the default if it's possible"). Run alone with: node src/cli/night-batch.ts --only=path.
  //     PATH 1, steady poison (dodging possible): the blind twin of nat4G at 400k. Expectation: glow hunters dodge (pick < blind) AND need
  //     less resistance than blind hunters (resistance glow < blind). Data so far points against it: at 200k glow pick 0.55 vs blind
  //     0.49 (lower in 5 of 14) and glow hunter resistance 0.29 vs blind 0.18 (handed out).
  //     PATH 2, poison getting stronger: poison plants 23% -> 40% over 300k, held 100k (= 1/3 more), glow and blind, 6 seeds (small test
  //     first). Slow on purpose: the 150k ramps broke hunters near 30%, and hunter resistance grows only ~0.01 per 10k ticks.
  //     Expectation: hunter resistance above the steady world (nat4G, same seeds 1-6) in >= 5 of 6, world works in >= 5 of 6.
  ["path1B-blind-steady-400k", "PATH 1 (steady): blind twin of nat4G, gene 0.3, 14 x 400k [proof]", ["--seeds=1-14", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=0"]],
  ["path2G-glow-ramp40-400k", "PATH 2 (stronger): glow, poison plants 23% -> 40% over 300k + 100k hold, gene 0.3, 6 x 400k [small test]", ["--seeds=1-6", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=300000", "--poisonPeak=0.4"]],
  ["path2B-blind-ramp40-400k", "PATH 2 (stronger): blind, same, 6 x 400k [small test]; pairs with path2G", ["--seeds=1-6", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=0", "--poisonRamp=300000", "--poisonPeak=0.4"]],
  // (4d) Rey 2026-11-20 ("all": why do real hunters dodge? two checks, both glow vs blind, 6 x 200k, baseline natG / natB seeds 1-6).
  //     Run alone with: node src/cli/night-batch.ts --only=why. Measured first [seed 1, 30k, hunter log]: a sick catch carries the capped
  //     dose 2 (median); 79% of hunters die within 1,000 ticks of one (39% after a clean catch). Arithmetic: dose 2 costs ~0.9 energy
  //     (0.000625 x 2 x 721) = ~7 meals; skipping costs one more search gap (median 58, mean 113 ticks) = ~0.04-0.07 energy, half a meal.
  //     So skipping pays 10-20x; the weak dodge is not about the price. Reading [not tested]: resistance is one dial and dodging needs
  //     the brain to wire glow to turning, so evolution finds resistance first.
  //     (b) SURVIVABLE LESSON: the most poison a hunter takes per catch 2 -> 0.5 (a sick catch ~1.8 meals, not ~7). Nature: predators
  //     learn from mistakes they survive. Prediction (low confidence): no clear change (gentler poison never made hunters dodge before).
  //     (c) OTHER FOOD: half the prey are a safe kind that never eats poison plants (safePrey 0.5). Prediction: little change, since 85%
  //     of prey are clean already. Done (either): glow pick < blind in >= 5 of 6. Kill: <= 3 of 6.
  ["whyCapG-glow-cap0.5", "(b) survivable lesson: glow, cap 0.5, gene 0.3, 14 x 200k [proof size; Rey: all, overnight]", ["--seeds=1-14", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--resistGene=0.3", "--hunterCue=2", "--hunterDoseCap=0.5"]],
  ["whyCapB-blind-cap0.5", "(b) survivable lesson: blind, same; pairs with whyCapG", ["--seeds=1-14", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--resistGene=0.3", "--hunterCue=0", "--hunterDoseCap=0.5"]],
  ["whySafeG-glow-safe0.5", "(c) other food: glow, safePrey 0.5, cap 2, gene 0.3, 14 x 200k [proof size; Rey: all, overnight]", ["--seeds=1-14", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--resistGene=0.3", "--hunterCue=2", "--hunterDoseCap=2", "--safePrey=0.5"]],
  ["whySafeB-blind-safe0.5", "(c) other food: blind, same; pairs with whySafeG", ["--seeds=1-14", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--resistGene=0.3", "--hunterCue=0", "--hunterDoseCap=2", "--safePrey=0.5"]],
  // (4e) Rey 2026-11-20 ("all, this will be overnight"). The trade-off gene and the bigger hangover test join the batch.
  //     TRADE-OFF (hunterSightTrade 1): a hunter's own resistance dims its glow sense (seen = min(1, poison x 10 x (1 - r))), so hunters
  //     must lean to dodging or to resisting. Glow world of the nature proof; baseline natG on file (same seeds, 200k). Prediction (low
  //     confidence): hunters split (many with resistance < 0.2, many > 0.6; the new "hunters by resistance" line) and poisoned share of
  //     hunter deaths falls below natG. Done: lower in >= 5 of 6 and works >= 5 of 6 (then the gated 14-seed proof runs). Kill: works < 3.
  ["trade6G-glow-sighttrade", "TRADE-OFF: glow, gene 0.3, hunterSightTrade 1, steady poison, 6 x 200k [small test]; baseline natG", ["--seeds=1-6", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--hunterSightTrade=1"]],
  ["trade14G-glow-sighttrade-proof", "TRADE-OFF: same, 14 x 200k [proof]; only if trade6G works in >= 5 of 6", [...PROOF, ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--hunterSightTrade=1"], passGate("trade6G-glow-sighttrade", 5)],
  //     HANGOVER, bigger: the best ramp result (early breeding 0.3 + glow-off hangover, half-life 100, 60% ramp, gene) at 14 x 200k with a
  //     blind twin. At 6 seeds: works 3 / 0 of 6, hunter die-outs 4.2 / 27.7 (no hangover: 78 / 76), pick 0.86 / 0.90.
  ["hang14G-glow-ramp60-early-glowoff", "HANGOVER: glow, 60% ramp, early breeding + glow-off hangover, 14 x 200k [proof]", [...PROOF, ...E, "--hunterCue=2", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--poisonRamp=150000", "--poisonPeak=0.6", "--resistGene=0.3", "--hunterPoisonHalfLife=100", "--hunterEarlyBreed=0.3", "--hunterHangover=1"]],
  ["hang14B-blind-ramp60-early-glowoff", "HANGOVER: blind twin, same, 14 x 200k [proof]; pairs with hang14G", [...PROOF, ...E, "--hunterCue=0", ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--poisonRamp=150000", "--poisonPeak=0.6", "--resistGene=0.3", "--hunterPoisonHalfLife=100", "--hunterEarlyBreed=0.3", "--hunterHangover=1"]],
  // (4f) Rey 2026-11-23 ("a"): is ~30% poison too MUCH for hunters, or did it come too FAST? Steady 35% from the start: poisonRamp 1
  //     jumps the share to poisonPeak at the first re-typing (tick 1,000) and holds it; no new setting. Control: natG / natB seeds 1-6
  //     (steady 23%). Done-if: works >= 5 of 6 (then it is the speed: try a slower or later rise). Kill-if: works <= 2 of 6 (35% is
  //     too much for hunters). Run with: node src/cli/night-batch.ts --only=lvl
  ["lvl35G-glow-steady35", "LEVEL: glow, steady 35% poison plants, gene 0.3, 6 x 200k [small test]; control natG seeds 1-6", ["--seeds=1-6", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=1", "--poisonPeak=0.35"]],
  ["lvl35B-blind-steady35", "LEVEL: blind twin, same; control natB seeds 1-6", ["--seeds=1-6", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=0", "--poisonRamp=1", "--poisonPeak=0.35"]],
  // (4g) Rey 2026-11-23 ("make it slower, like 0.1 slower; nature takes decades"): the path-2 rise 10x slower: 23% -> 40% over
  //     3,000,000 ticks (path2 took 300k), run to 2,000,000 ticks (share ~0.34 at the end; it crosses the hunters' ~30% break point
  //     at ~1.2M). Rey 17:42: "make this a proof: it's not the poison too potent, the hunters evolve too slowly as they are slow"
  //     (checked, seeds 1-2, 30k: a slow hunter generation is ~2,900-3,500 ticks, a fast one ~615-680, so 5x fewer generations).
  //     Rey 17:50 "use less seeds": SMALL TEST on seeds 1-6 (the seeds of path2, lvl35 and the natG / natB controls), not a proof.
  //     Done-if: works >= 5 of 6 at 2M (fast rise: 0 of 6; steady 35%: 3 / 1 of 6). Kill-if: works <= 2 of 6.
  //     Run with: node src/cli/night-batch.ts --only=slow (glow + blind) or --only=slow6G (glow alone)
  ["slow6G-glow-ramp40-x10", "SLOW RISE: glow, 23% -> 40% over 3M ticks, run 2M, gene 0.3, seeds 1-6 [small test]", ["--seeds=1-6", "--ticks=2000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.4"]],
  ["slow6B-blind-ramp40-x10", "SLOW RISE: blind twin, same [small test]; pairs with slow6G", ["--seeds=1-6", "--ticks=2000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=0", "--poisonRamp=3000000", "--poisonPeak=0.4"]],
  // (4h) Rey 2026-11-23 23:52 ("a"): does the ramp machinery itself shake the world? A FLAT ramp (a do-nothing control): ramp on, peak =
  //     the normal world's own share 54 / 234 = 0.230769, so the share never moves but plants are still re-typed every 1,000 ticks and
  //     the caps still follow. Glow, seeds 1-6 x 200k; compare natG seeds 1-6 (die-out rounds ~2 by 200k) and slow6G (~8 by 200k).
  //     Done-if: rounds at 200k average <= 3 (the machinery is innocent). Kill-if: >= 6 (it causes crashes: fix it before any ramp result).
  ["flat6G-glow-flatramp", "FLAT RAMP control: glow, ramp on but held at 0.2308, gene 0.3, seeds 1-6 x 200k [check]", ["--seeds=1-6", "--ticks=200000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.230769"]],
  // (4i) 2026-11-24: the 10x slower rise again on the FIXED ramp (caps only, poison grows in patches; f8b8d11). Same as slow6G otherwise.
  //     Compare slow6G (old ramp: works 3 / 1 of 6). Done-if: works >= 5 of 6. Kill-if: <= 2 of 6. Run with: --only=fix
  ["fixslow6G-glow-ramp40-x10", "SLOW RISE on the fixed ramp: glow, 23% -> 40% over 3M, run 2M, gene 0.3, seeds 1-6 [small test]", ["--seeds=1-6", "--ticks=2000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.4"]],
  // (4j) Rey 2026-11-24 02:50 ("add back the hangover and a lot of stuff that failed; try if very slow changes help the predators adapt"):
  //     the failed balancers that are still in the code, each ALONE on the fixed 10x slower rise (same as fixslow6G), plus ALL TOGETHER on
  //     half the seeds (testing rule 6). Senses handed out only (--conds=0) to halve the cost; fixslow6G (both conditions) is the base.
  //     Measured per arm vs fixslow6G, same seeds: works, hunter die-outs, hunter resistance at 1.2M and 2M, poisoned share of hunter deaths.
  //     Done-if (per arm): works >= 5 of 6 AND more than the base. Kill-if: works below the base. Run with: node src/cli/night-batch.ts --only=fix
  ...([
    ["fixHang", "hangover: early breeding 0.3 + glow-off hangover + half-life 100 (the best 60%-ramp arm, Nov 13)", ["--hunterPoisonHalfLife=100", "--hunterEarlyBreed=0.3", "--hunterHangover=1"]],
    ["fixIdle", "cheap waiting: resting hunters burn less (hunterIdle 0.25)", ["--hunterIdle=0.25"]],
    ["fixBite", "the bite: hunters can refuse prey in reach (hunterBite 1)", ["--hunterBite=1"]],
    ["fixGut", "the stomach: food digests slowly (digest 8)", ["--digest=8"]],
    ["fixTrade", "the sight trade-off: glow seen x (1 - resistance) (hunterSightTrade 1)", ["--hunterSightTrade=1"]],
  ] as [string, string, string[]][]).map(([n, what, a]) => [`${n}6G-x10`, `SLOW RISE + ${what}; glow, seeds 1-6 x 2M, handed out only [small test]`,
    ["--seeds=1-6", "--ticks=2000000", "--conds=0", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.4", ...a]] as [string, string, string[]]),
  ["fixAll3G-x10", "SLOW RISE + ALL five together (hangover, cheap waiting, bite, stomach, sight trade); glow, seeds 1-3 x 2M, handed out only [small test, rule 6]",
    ["--seeds=1-3", "--ticks=2000000", "--conds=0", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.4",
      "--hunterPoisonHalfLife=100", "--hunterEarlyBreed=0.3", "--hunterHangover=1", "--hunterIdle=0.25", "--hunterBite=1", "--digest=8", "--hunterSightTrade=1"]],
  // (4k) 2026-11-24: does the SLOWNESS matter, or was the old ramp machinery the whole problem? The FAST rise (path2: 23% -> 40% over 300k,
  //     run 400k) again on the fixed ramp. Compare fixslow6G (works 5 / 6 of 6) and path2G on the old ramp (0 / 0). Done-if ("time matters"):
  //     works <= 2 of 6 here. Kill-if ("only the machinery mattered"): works >= 5 of 6. Run with: --only=fixfast
  ["fixfast6G-glow-ramp40-300k", "FAST RISE on the fixed ramp: glow, 23% -> 40% over 300k, run 400k, gene 0.3, seeds 1-6 [small test]", ["--seeds=1-6", "--ticks=400000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=300000", "--poisonPeak=0.4"]],
  // (4l) Testing rule 1, missed on 2026-11-24 (Rey: "you forgot the instruction we set before"): fixslow6G passed its done-if (works 5 / 6
  //     of 6), so its proof must be queued behind the gate. 14 seeds x 2M, both conditions (28 runs). Run with: --only=fixslow14
  ["fixslow14G-glow-ramp40-x10-proof", "SLOW RISE on the fixed ramp: glow, 23% -> 40% over 3M, run 2M, gene 0.3, 14 seeds [proof]; only if fixslow6G works in >= 5 of 6",
    ["--seeds=1-14", "--ticks=2000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=3000000", "--poisonPeak=0.4"], passGate("fixslow6G-glow-ramp40-x10", 5)],
  // (4m) Rey 2026-11-24 13:47 ("seperate it into 4 phase, ori, posion, back to ori, back to poison, the tick increase only for season"):
  //     the POISON SWING on the fixed ramp (caps only, poison grows in patches): 3M ticks (fixslow 2M + 50%), four phases of 750k:
  //     23% / 40% / 23% / 40%. Each switch is a step (poisonRamp 1); the living share follows within ~2,500 ticks [checked, seed 2].
  //     No new setting: season + poisonRamp (plants.ts rampShare). Marks every 375k (middle and end of each phase).
  //     Compare fixslow6G (same seeds, same world, slow rise to 0.34 at 2M). Done-if: works >= 5 of 6. Kill-if: <= 2 of 6.
  //     Gated proof (testing rule 1): 14 seeds, runs only if the small test works in >= 5 of 6. Run with: --only=swing
  ["swing6G-glow-4phase-3M", "POISON SWING on the fixed ramp: glow, 3M, phases 23% / 40% / 23% / 40% (750k each), gene 0.3, seeds 1-6 [small test]", ["--seeds=1-6", "--ticks=3000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=1", "--poisonPeak=0.4", "--season=3000000"]],
  ["swing14G-glow-4phase-3M-proof", "POISON SWING: same, 14 seeds [proof]; only if swing6G works in >= 5 of 6",
    ["--seeds=1-14", "--ticks=3000000", ...E, ...SAME, "--poisonDose=0.75", "--hunterDoseCap=2", "--resistGene=0.3", "--hunterCue=2", "--poisonRamp=1", "--poisonPeak=0.4", "--season=3000000"], passGate("swing6G-glow-4phase-3M", 5)],
  // Empty on 2026-11-13: every queued test is finished and recorded in HISTORY.md (git keeps the old entries; last full queue: 26f0ccb).
  // Helpers above: E, SAME, SLOW (now the engine default), FOOD2, CHECK, PROOF, worksGate, sweetGate, passGate. --only=<name start> runs a subset.
];

mkdirSync(DIR, { recursive: true });
const t0 = performance.now();
// --only=<start of a test name>: run just the tests whose name starts with it (Rey 2026-11-11: "just that"); the rest stay queued
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean); // --only=path,why,... (Rey 2026-11-20)
for (const [name, what, args, skipIf] of TESTS) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
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

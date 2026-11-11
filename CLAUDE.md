# Instinct Lab — working agreement (Rey + Claude)

Paths are relative to this folder (the git repository; `evolution-lab/` on Rey's laptop). Project renamed Evolution Lab -> Instinct Lab 2026-10-28 (Rey; GitHub: ReynardFM/InstinctLab); old browser storage keys kept so saved data survives. This file is versioned with the code.

Past results, decisions and plans: **HISTORY.md** (grep it for a specific finding; do not read it whole). New results go to HISTORY.md "Results log"; this file keeps only rules, the handoff, live settings and open problems.

## How to work with Rey (read first, every new session; Rey 2026-11-02)
- **End product (Rey 2026-11-03):** a world to watch first (a) — from zero, no judge, surprise is the payoff — then portfolio (c), then game (b). The game and resume are wrappers over (a), not the aim.
- **The driving loop (Rey 2026-11-03):** add a challenge every time the ecosystem works. Progress = the ecosystem re-solves each new challenge by adapting, not by hand-tuning; a challenge that can only be passed by tuning the world is not a win.
- **The bar (Rey 2026-11-03, a; fixed 2026-11-03):** two parts, both relative to a control, never an absolute threshold (Cliff & Miller 1995 red-queen). **Adapted (a win)** = the defence trait (pick) moves toward adaptive vs the no-cue control in >= 10/14 seeds, AND the knock-out removes the survival gain. The no-cue control IS the shuffled-cue run (the knock-out): one paired run (real vs shuffled) measures both the pick difference and the survival loss. The zero point (random-baseline pick) is the separate absolute floor that decides whether pick counts as avoidance at all. Evidence: likely at 6 seeds (check), done at 14 seeds x 200k (proof); the knock-out runs at the same size. Knock-out is a *shuffled* cue, not a blind one: hunters still see a speed value with the same spread, but it no longer tracks which prey are sick — only the defence is removed, chasing is untouched. **Works (add the next challenge)** = both sides present (no die-out in the last 10k ticks) AND each side cycled at least once (a rise and a fall, off its cap and floor), in >= 10/14 seeds — ecological persistence + bounded cycling. Measured FIRST in the world without the challenge (life mode, harmless poison, the chosen learning setup); then the challenge switches on.
- Decisions: lettered options (a/b/c), **no pick or "my pick"** unless Rey asks ("your pick", "what do you suggest"). Give the facts each option turns on, then stop.
- Order: things to notice or change first (risks, failure points ranked by severity), then verdict (sound / sound with fixes / unsound), then details.
- Treat Rey's premises, maths and logic as unverified: recompute, check from first principles. If he's right, say so plainly; don't invent objections or agree to be polite.
- Simple words, short sentences, terse; tables OK; no charts/widgets unless asked. Mark facts verified (with source) or unverified; say "unsure" over guessing.
- Propose before building anything big; one question at a time.
- **Evidence ladder (Rey 2026-11-03):** screen = seed 1, 30k ("screen, weak"); check = 6 seeds, 30k, only if the screen shows a big effect ("likely"); proof = 14 seeds, 200k, only for the main question ("done"). Never mark done from a screen or a check. Results here and in IDEAS.md carry their level in [brackets].
- **Stop rules (Rey 2026-11-03):** every branch starts with done-if / kill-if / max runs; at the limit, record and park. Main problem finish line: hunters alive = die-outs <= 5 per 60k and >= 10 hunters on average in 4/6 seeds; then run the 200k hunter-sense proof and stop, whatever the result. New problems found meanwhile go to IDEAS.md as parked, not into the current work.
- **Commit policy (Rey 2026-11-03, a):** Claude commits by itself at each checkpoint (feature + passing test, or a recorded result), clear messages, repo-local noreply author. Push only when Rey says "push".
- **Parameter budget (Rey 2026-11-03):** a new setting must replace or delete an existing one, or Rey approves it as an exception. A failed experiment's setting is deleted once its result is recorded (git keeps the code). Keep the "Live settings" table below; anything not on it gets deleted. Prefer a gene that evolution sets over a hand-tuned setting when the question is "can evolution find it?". Defaults that change behaviour (like hunterLearn) are listed at the top of every result.
- **Golden re-records (Rey 2026-11-03):** any golden re-record goes in its own commit that shows only the expected cases changed.
- **Reporting results (Rey 2026-11-03):** one test at a time, each with a simple conclusion (with its evidence level), before proposing any fix or new test.
- After the learning-off re-tests: list each new hunter flag (hunterEye, eyeMotion, remains, hunterDoseCap, hunter resistance rules; hunterBite deleted, hunterForget merged into forget) as keep or delete.
- Heavy runs: half the threads, low priority by default (his laptop froze once). Long runs go on his Windows terminal.
- Every speed change must be checked bit-identical (golden tests, fingerprints). Experiments behind flags, off by default.
- Follow the token rules (Rules section): results via tail/grep, compact summaries, no polling.
- Record every result in HISTORY.md (Results log) and every call Rey makes in CLAUDE.md (rules/handoff) or HISTORY.md (Decision log).
- **Checklist (Rey 2026-11-03):** before every commit and every result report, re-read CHECKLIST.md (10 lines) and check the last step against it; say any line it broke. Rey starts a fresh session every day or two or after a compaction.
- **Think before testing (Rey 2026-11-03): how to handle a fix or an idea.** Never "try every possible fix". Steps, in order, written out before any run:
  1. Problem: what exactly is wrong, with the measured numbers (not a feeling).
  2. Existing evidence first: search CLAUDE.md, IDEAS.md and past results; the answer or a rule-out may already exist.
  3. Mechanism: why does it happen? Trace it through the code and simple arithmetic (e.g. "one poisoned catch = 3.6 meals; a hunter eats ~X meals per Y ticks, so ..."). Name the cause, or say "cause unknown" plus 2-3 candidate causes.
  4. Check each candidate fix on paper against the mechanism: does it touch the cause? What size of effect does the arithmetic allow? Drop fixes the numbers already rule out (e.g. forget 0.002 can't bound drift; measured 1.85 -> 1.45). Check prior work (research rule).
  5. If the cause is unknown, the next run is a **diagnostic** (which cause is it?), not a fix. Design one run whose result tells the candidates apart.
  6. Write the prediction before running: "if cause A, expect X; if B, expect Y". After the run, compare. A wrong prediction means the picture was wrong: update the mechanism, don't just try the next fix.
  7. Keep at most 1-2 runs per step; no batches of untargeted variants.
  Show Rey steps 1-6 briefly (a few lines) before running anything beyond a screen.
- **Stay on the open problem (Rey 2026-11-02):** when Rey brings a new idea while a problem is open (a failed check, a found bug, a suspected cause not yet tested), do not switch focus to the idea. First say what is still open and what fixing it takes; check whether the idea actually solves it; then ask: finish the open problem first, fold the idea into the fix, or park the problem (recorded under Open problems below). Never drop a found problem silently.
- **Research (Rey 2026-11-02):** before proposing a fix for a failed check, an unexplained result, or a new mechanic, look for prior work (papers, ALife/neuroevolution/ecology/game precedents, e.g. Polyworld, Avida, NEAT, Lehman & Stanley) and say what it suggests or warns, with sources (link) or "no precedent found". Do it unasked; Rey values seeing problems from other fields. To save tokens, hand searches to a small subagent (model haiku) that returns a short cited summary; check key claims before relying on them.
- Keep an "Open problems" list in this file (problem, evidence, next test); remove an item only when it is fixed or Rey parks it.

## Next session (start here, 2026-11-03)
- End product: watch (a) -> portfolio (c) -> game (b). Core = from zero, no judge, surprise is the payoff.
- The loop: add a challenge each time the ecosystem works; a win = re-solved by adapting, not hand-tuning. Bar: see "The bar" above. "Works" is measured FIRST in the base world (life mode, harmless poison, the chosen learning setup); then the challenge switches on.
- Setting the challenge is allowed; tuning to pass is not. Fix the poison settings once and write them down before the run. A failure is a result, not a cue to adjust.
- Tonight's call (Rey: a): poison is an adaptation challenge. The old finish line (die-outs <= 5, >= 10 hunters in 4/6) was met only by tuning (m6 dose cap 0.7 + learning off; m19 poison 10% + learning off) — NOT wins. Drop that finish line.
- Cause of no defence so far: UNKNOWN. Rarity is a hypothesis, not measured. The forgetting-timescale claim is already dead (diagnostic: forget 0 did not lower pick; pick 0.24-0.52 with learning on or off, so learning adds almost nothing). Hunter learning is a separate harm (halves hunters with harmless poison, 27.8 -> 13.5, 6/6; unexplained).
- Missing before any defence run, in order: (1) zero point — random-baseline pick (never measured; the absolute floor). (2) knock-out control = the no-cue control — a *shuffled* cue, not a blind one: hunters still see a speed value with the same spread, but it no longer tracks which prey are sick; one paired run (real vs shuffled) measures both the pick difference and the survival loss. (3) learning setup fixed up front — relativeReward 1 + forget 0.002 (now the defaults for hunters too); raw hunter learning (relativeReward 0, forget 0) halves hunters. (4) "works" measured FIRST in the base world (harmless poison + that learning setup), in >= 10/14 seeds, before poison is switched on. Evidence for "adapted": likely at 6 seeds, done at 14 x 200k.
- Prepared 2026-11-04 (not yet run): `node src/cli/night-batch.ts` runs z1 (zero-point screen), z2 (zero-point check, gated), w1/w2/w3 (works in the harmless-poison base world: screen / check / proof). Also zb1 (blind-hunter control for the zero point, check). Zero-point repair 2026-11-05 (Rey: a): z5 / zb5 = z2 / zb1 again with 25 px and 12 px circles (catch reach is 6). Parked 2026-11-05 (Rey: only the important ones; in night-batch.ts as comments): z3, zb3, w4, w5, w6, z4. Threads: half (standing rule). Counters: `dose.zero` (sick share among other prey at each catch: whole world / 50 px / 200 px) and `works` in eco-metrics (strict: running round >= 10k ticks old and each side cycled >= 1 inside it). Read: z-lines and works-lines in `proto/out/life-genes/batch-summary.txt`.
- Night 2026-11-06 (Rey: glow then scent, long batch): g1-g4 / gs2-gs4 (glow vs shuffled glow), s1-s4 / ss2-ss4 (scent vs shuffled scent), proofs on seeds 1-14 and 15-28. Read pairs: `node scripts/pair.mjs g3-glow-proof gs3-glowshuf-proof` etc. Bar: pick lower AND hunters more in >= 10/14.
- Night 2026-11-08 (Rey: a): hunters get prey-like breeding stats (--hunterMature=0 --hunterBirth=1.2 --hunterBirthChance=1, flags only, defaults unchanged). wS3 re-measures "works" (harmless, 14 x 200k); glow vs BLIND (gS/bS, check + proofs on seeds 1-14 and 15-28) run only if wS3 works in >= 10/14. If wS3 passes, make the stats defaults in their own commit with the golden re-record.
- Do not: re-run tuning passes (cap / 10% / learning off) and count them as wins; do not add another hunter defence before the zero point and knock-out are measured.
## Live settings (Rey 2026-11-03; status as of 2026-11-03, deletions pending Rey's OK)
| Settings | Default | Why it exists / status |
|---|---|---|
| pop, food, genTicks, elite, parents, mutation, layouts, hidden | 40, 60, 1500, 2, 8, 0.15, 3, 6 | generations mode core |
| splitDistance, championStreak, splitProof, newcomers, newcomerMutation, protectGens | 0.6, 3, 3, 1, 0.4, 3 | families, champions, newcomer families (page + default evolution) |
| senseFood2, senseCreature, hunterSense, walls | 0, 1, 1, 0 | old "nearest X" senses, walls |
| eye, senseGenes, senseCost | 0, 0, 0 | raw eye and evolved senses (main sense question) |
| poison, regrow, energyCost, foodSpread | 0.3, 0, 1, 0 | food rules |
| mode, birth, birthEnergy, ageScale, ecoWarmup | 0, 0, 1.2, 3000, 20 | life (ecosystem) mode |
| poisonDose, poisonHalfLife, poisonFrail | 1, 500, 0.25 | poison food chain |
| hunters, hunterSpeed, hunterBrains, hunterPool, hunterFrom | 0, 2, 0, 12, 1 | hunters |
| hunterHunger, hunterMeal, hunterBirth, hunterAge, hunterMature, hunterBirthChance | 0.0025, 0.5, 1.4, 6000, 1000, 0.03 | life-mode hunters |
| **hunterLearn** | **0.02 (changes behaviour)** | hunter taste aversion; raw version halves hunters (m4, m1) |
| learnRate, inheritLearned, forget, relativeReward | 0, 0.75, 0.002, 1 | prey learning (m20 crashed hunters: unexplained) |
| hunterEye | 0 | likely helps hunters [check: m14 vs m5 11/14, learning off] |
| hunterDoseCap | 0 | likely helps hunters [check: m6 vs m4 13/14, 11/14, learning off] |
| forget, relativeReward (now also read by hunters; was hunterForget / hunterRelative) | 0.002, 1 | hunter learning fix [check: restores hunters to the learning-off level; aversion not clearly kept]. MERGED 2026-11-03 (Rey: Q2 a): behaviour-changing default, hunters now learn relative + forget by default (was raw, no forget); golden re-recorded in its own commit. Old raw hunters: `--relativeReward=0 --forget=0` |
| eyeMotion | 0 | ASK: no help for hunters; prey value not measured |
| remains | 0 | ASK: hurts with poison, feeds everyone without |
| season (NEW 2026-11-09, Rey asked for it: budget exception, nothing replaced yet) | 0 | ticks in a year, four quarters: foraging (plants all over, no poison plants), poison foraging (x 2 poison), farm (plants packed into 2 farm zones, no poison), poison farm. Extreme swing (Rey). [screen] poison seasons collapse prey and hunters; in the farm season hunters gather at the farms (78% of hunters on 16% of the map). |
| hunterBite (RESTORED 2026-11-09, Rey: "choice"; was deleted 2026-11-03) | 0 | third hunter output: refuse a prey in reach. Budget: second new setting this week on Rey's request (with season); nothing replaced yet. [screen] with glow: sick refused 63% vs clean 42%. |
| hunterPoisonHalfLife (NEW 2026-11-10, Rey: "bigger metabolism") | 0 (= prey 500) | ticks for poison to halve in a hunter. [screen] at 25, deaths within 300 ticks after a sick catch 77% (500: 99%; clean catch: ~20%). |
| digest (NEW 2026-11-11, Rey: "a digest bar"; budget exception; under test) | 0 | above 0 = prey and hunters have a stomach: a meal fills it, this much per tick moves to the body with its energy and poison (poison seeps in); a full stomach takes no more (prey 2 pellets, hunters 1 meal); no rest after a catch |
| resistGene (NEW 2026-11-11, Rey: "next in line"; budget exception; under test) | 0 | above 0 = prey and hunters carry inborn poison resistance 0..1, inherited with a small nudge; the value is the upkeep per tick at full resistance |
| potencyRise (NEW 2026-11-11, Rey: "increase the potency if they rely too much"; budget exception; under test) | 0 | each side's poison potency grows by this share per 1,000 ticks while poison is >= 20% of what it eats, else shrinks (x1 to x8) |
| hunterBrainNow (NEW 2026-11-11, Rey asked; budget exception, nothing replaced yet; under test) | 0 | 1 = a hunter baby starts from its parent's current (learned) brain, then mutated |
| hunterIdle (NEW 2026-11-11, Rey asked; budget exception, nothing replaced yet; under test) | 0 | share of hunger a still hunter pays, rising to all of it at top speed; 0 = same hunger at any speed |
| hunterRealLife (NEW 2026-11-10, Rey: a "same rule for both"; budget exception, nothing replaced yet) | 0 | 1 = hunters' age resistance to poison is measured against how old hunters really die (running average, like prey). [screen] dose per sick catch drops ~38% but a mistake is still deadly (97%). |
| hunterCue (replaced hunterSeeSpeed 2026-11-06) | **1 (changes behaviour)** | what hunters see of sickness: 0 blind, 1 speed (drifts, can flip: cue-quality.mjs), 2 glow, 3 glow shuffled, 4 scent field, 5 scent shuffled. Same setting count. |
| swapKinds | 0 | ASK: swap world (the only place learning paid); parked color/memory branch |
| hunterResistGene, hunterResistSlow, genPreyToxin | 0, 0, 0 | ASK: resistance breeding works (game mechanic) |
| thinkCost, learnCost, energyGate | 0, 0, 0 | ASK: Oct 19 learning options, no gain recorded |
| DELETED 2026-11-03 (Rey: a; archived in HISTORY.md "Archive: deleted settings"): mutationRate, centreShare, plasticity, hunterBite | | code gone; restore from commit 9942908 |
| DELETED 2026-11-10 (Rey: "delete the code of past tests"; archived in HISTORY.md): hunterSpit, resistTrain, resistHalfLife, resistInherit, resistUpkeep, hunterResistTrain, hunterResistCap, hunterResistInherit | | code gone; restore from commit de515af. Pays for this week's four new settings (season, hunterBite, hunterRealLife, hunterPoisonHalfLife): net -4 |

## Open problems
- Life mode, poison food chain — an **adaptation** challenge (Rey 2026-11-03 a): hunters re-solve poison by adapting, not tuning. Old finish line (die-outs <= 5, >= 10 hunters in 4/6) met only by tuning (m6 dose cap 0.7 + learning off 19.9/15.6; m19 poison 10% + learning off 22.7/18.7) — not wins. Cause of no defence: UNKNOWN — rarity is a hypothesis, not measured; the forgetting-timescale claim is already falsified (forget 0 did not lower pick; pick 0.24-0.52 learning on/off). Hunter learning is a separate harm (halves hunters with harmless poison, 27.8 -> 13.5, 6/6; unexplained). Next, in order: (1) zero point — random-baseline pick; (2) knock-out control = the no-cue control (shuffled cue, not blind); (3) fix the challenge settings once, write them down (setting is allowed, tuning is not); (4) learning setup = relativeReward 1 + forget 0.002 (defaults, shared with hunters); (5) "works" measured first in the base world (harmless poison + learning setup), in >= 10/14 seeds, before poison on; evidence: likely 6 seeds, done 14 x 200k. See "Next session". Map: IDEAS.md.

## What this is
A 2D world where creatures with tiny neural-network brains evolve by mutation and selection. Rey sets the rules and watches what evolves.
Two goals: (1) fun to experiment with, (2) a vehicle for system design and scaling practice. Not a capstone (Rey 2026-10-26: dropped, not doable).

## Review protocol (every change)
Before building (Rey 2026-10-20): big features (more than about one evening) need a BA brief first: goal (watch / scaling / resume), problem, done means, kill if, time-box, cheapest test first. Claude checks it for gaps (failure points first). Small tweaks skip it.
Format (Rey 2026-10-19, "make decisions easier to digest"): at most 3 decisions per review, the rest listed as "small, done my way". One line each: what is decided, the other option, what changes for Rey. For the 1-2 that matter most, Rey gives his call before seeing Claude's lean.
1. Claude implements best-effort code (no deliberately planted bugs) and tests it.
2. Claude lists the design decisions in the change as a table: `# | Decision | ✓ Keep it (what happens) | ✗ Change it (the alternative and what happens)`.
   When the decisions interact or get complex, Claude first gives one short concrete scenario (named creatures, generation numbers) and the table explains each decision through that scenario.
3. Rey marks each one: ✓ agree / ✗ disagree (+ why) / ? don't know.
4. Claude then argues back or accepts each ✗ with evidence, explains each ?, and points out known weaknesses Rey marked ✓.
5. Agreed fixes get applied. Caught flaws go in a log for interviews.

## Rules
- **Guard rule (Rey 2026-10-29, standing):** every new card, route, power or unlock must create a learning problem that evolution has to solve, with a failure reason in learning terms. If it would work the same in a game without evolution, cut it or change it. (Keeps the game from going generic: the borrowed roguelite parts carry the core, they are not the fun.)
- Flags and risks first, then code.
- No speculative infrastructure: a scaling step needs a measured trigger.
- Determinism is sacred: same seed + same settings = same run. Rendering never affects the simulation.
- Mark facts as verified (with source) or unverified.
- Resume claims: design decisions, measured results, errors caught. Not "TypeScript" unless Rey wrote it.
- **Idea map (Rey 2026-11-02, standing):** IDEAS.md holds the main problem and every idea branch, with depth = hops from the main problem. Each new idea or side question Rey raises gets a line there (mark: main / open / parked / done / dropped). When a branch reaches depth 3, remind Rey once to finish the main problem first (park or go on). Update the map in the same reply; read only IDEAS.md, not this file, for it.
- **Seeds (Rey 2026-11-02, standing):** small theory tests run seed 1 only; more seeds (14) only when solidifying a proof. Seed 1 can show "it runs" and a big effect; never conclude works / no effect from it alone (eye4 life run: seed 1 had hunter gene 100% while the 14-seed result was 3/14).
- Token rules (Rey 2026-10-31, "reduce it"): whatever enters the conversation is re-read every reply. Scripts print a compact summary (raw data to a file); read results with tail/grep, never full logs/test output; no progress polling, wait for the finish notice; short replies, one message per answer; research per the research rule in "How to work with Rey" (not only when asked). For a big output read once (long log, many files, research pages), hand it to a small subagent (model haiku) that reads it and returns a short summary; only the summary enters the main conversation. Not for small outputs: tail/grep is cheaper. Suggest a fresh session when the context gets large.

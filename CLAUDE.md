# Evolution Lab — working agreement (Rey + Claude)

Paths are relative to this folder (`evolution-lab/`, the git repository). This file is versioned with the code.

## What this is
A 2D world where creatures with tiny neural-network brains evolve by mutation and selection. Rey sets the rules and watches what evolves.
Two goals: (1) fun to experiment with, (2) a vehicle for system design and scaling practice.

## Current state (2026-10-18)
- Engine `src/engine` (world, lineage, creature, senses, space, brain, rng), page `src/web`, CLI `src/cli`, checks `src/check` + `scripts`. README has commands and the file tree.
- `test/golden.json` pins the basic rules ("42", "7", "hello", "custom") and the current defaults. Re-record with `npm run record-golden` only for a deliberate behaviour change, and say so in the commit. All engine math goes through `src/engine/dmath.ts` (identical bits in every JS engine); never call Math.sin/cos/tan/atan2/exp/log/pow or ** in the engine.
- Machine: Rey's laptop is an Intel Core Ultra 7 155U (2 P-cores + 8 E-cores + 2 low-power E-cores, 15 W). Parallel efficiency: 100% to 2 workers, 74% at 4, 36% at 14 (unequal cores + power limit; start-up only 201 ms).
- Before every commit: `npm run check` (types + tests + dist up to date). One commit per reviewed change; message says what changed and what was measured.
- Baseline, current defaults with deterministic math (2026-10-18, 7 seeds x 100 generations, cloud): score 42.3 ±2.8, top half 46.8, 6.2 families alive, 1.1 champions per 100 generations, about 2.7 generations/s on one cloud thread.
- Git author email is the GitHub noreply address (182705433+ReynardFM@users.noreply.github.com), set for this repo only.

## Next session
1. Push to GitHub (author email already noreply).
2. Evolution batch: sparse mutations, Evolution Strategies centre brain.
3. Optional: open determinism.html in Edge and Firefox to confirm they match too.

## Decision log
0. Done 2026-10-16: page batch 1 (drifting colours, death marks, worst-to-best band, living-only family count) and speciation by brain difference (`splitDistance`, default 0.6, measured: about 1 split per 3-4 generations, 1-5 families alive). Display-only: golden test unchanged.
   Done 2026-10-17: legacy record for extinct families (last 500 kept) and champions (`championStreak`, default 3): an elite on top N generations in a row becomes its family's main brain.
   Finding 2026-10-17: scores are mostly luck from food placement. A best creature stayed on top 5 generations in a row 0 times in 500 generations (max 4). Fix candidate for the evolution batch: score each creature on several food layouts.
   Review 2026-10-17 (all kept): champion = best N gens in a row; only the family's top elite can be crowned; crowned once; founder brain kept; legacy cap 500, page shows 6. Legacy stores peak size + best food only. When building speciation part B, add each family's per-generation average to legacy.
   Done 2026-10-17: food layouts (`layouts`, default 3): each brain is scored on several maps per generation, food adds up, history is per layout. layouts=1 = old behaviour (golden test). Measured: one layout's scores agree only 0.28 between maps; same compute, 3 layouts matched 1 layout's score (38.0 vs 37.8) with much tighter seeds (37.2..38.4 vs 35.1..39.8). Champions still rare (max streak 4). Generations ~3x slower.
   Review 2026-10-17 (all kept): layouts default 3; everyone shares one map; score = total food; dead creatures come back fresh next layout; elites re-scored every generation; chart per layout.
   Done 2026-10-17: stage 3a. Runs are pure jobs (seed + rules + generations), a pool of worker threads takes the next job when free, results return in job order. Cloud 2 cores: 1.70x with 2 workers (85%), identical results. Rey's machine (14 logical cores, one trial): 1/2/4/8/14 workers = 5.0/10.6/19.8/32.0/39.6 gens/s; near-perfect to 4 workers, 7.88x at 14 (56%). Cause of the drop past 4 not measured yet (suspects: unequal cores, lower clock when all are busy).
   Review 2026-10-17 (all kept): one job = one run; threads in one process; default all cores; free worker takes next job; results in job order; a crash stops the experiment; bench checks identical results.
   Done 2026-10-17: speciation part B. A drifted child starts a branch on trial inside its family; it becomes a family after out-eating the rest of its family `splitProof` generations in a row (default 3; 0 = old instant split). Families now keep avgHist (also in legacy). Measured (100 gens, seeds 1-3): new families 26.0 -> 10.7 per 100 gens, about half of trials fail, but proven families live barely longer (8.7 -> 10.2 gens). Bookkeeping only: evolution identical.
   Review 2026-10-17 (all kept): win = branch avg > rest-of-family avg, 3 in a row, a loss resets; wins by default if the rest of the family is gone; on-trial members keep family colour and stats; no nested branches; drifters join a close existing branch; branch members can't be crowned; family avgHist kept in legacy. Idea for the evolution batch: protected newcomer families (families are only labels now, so they die fast).
   Done 2026-10-17: senses and world. Senses in `senses.ts`, all through `nearest()` in `space.ts` (brute force). Rules senseFood2 (default 0), senseCreature (default 1), walls (default 0); brain inputs 4 + 3 + 3 + 1. Measured (100 gens, seeds 1-3): creature sense 37.8 -> 44.6 (real), 2nd food no effect (37.5), walls a harder world (33.9). Creature sense doubles cost per creature-tick (~1.2 -> ~2.3 µs): first candidate for the uniform grid when pop grows. Golden still passes with all extras off.
   Review 2026-10-17 (all kept): senses are on/off rules and the brain grows to match; defaults from measurement; hidden layer stays 6; nothing sensed = far/unknown; walls stop and slide; one switch for walls + wall sense; neighbour = any family; brute force until the grid trigger; sight lines for the selected creature only. Next: evolution batch, starting with protected newcomer families.
   Done 2026-10-17: newcomer families (`newcomers` 1, `newcomerMutation` 0.4, `protectGens` 3): each generation a good parent mutated hard starts a family; while protected its best keeps a seat and has one child. Measured: families alive 1.2 -> 6.1; gentler mutation (0.4 vs 1.0) is what lets newcomers survive (40 vs 4 of 300), protection mainly keeps more families on screen. Lab score (everyone's average) drops ~3 because weak newcomers count; top half unchanged within noise (unsure). Not yet: sparse mutations, Evolution Strategies centre.
   Review 2026-10-18 (all kept): 1 newcomer/gen from a top-8 parent, mutation 0.4, protection = best keeps seat + 1 child for 3 gens, newcomer is its own family at once. Changed: `npm run lab` now also prints a "top half" score (World.topHalfHist), so runs with and without newcomers compare fairly.
   Git 2026-10-18: repo in `evolution-lab/` (branch main, first commit 9e8d5f3 after the email rewrite). One commit per reviewed change, message says what changed and what was measured. `dist/app.js` is committed on purpose (double-click works without npm install). (This file was outside the repo until the 2026-10-18 fixes.)
   Fixes 2026-10-18: commit email switched to GitHub noreply (history rewritten before any push); world.ts split into world/lineage/creature (proved identical); determinism.html + defaults golden + npm run check; lab defaults to 7 seeds with a ±95% column; bench takes the median of 3 trials and prints CPU model and worker start-up time; fresh baseline recorded (champions fire 1.6 per 100 generations, inside the agreed 1-2 target, so no change); this file moved into the repo.
   Done 2026-10-18 (Rey chose A): deterministic math. dmath.ts gives sin/cos/tanh/log from + - * / only; senses rotate by the heading instead of using atan2; brainDistance uses d*d instead of **. Every number changed, so golden was re-recorded (the original-version link ends here; git has the history). Chrome 141 now matches Node 22 exactly. Score unchanged within noise (42.3 ±2.8 vs 43.2 ±2.7). Speed: default rules unchanged, basic rules 23% slower.
   Bench 2026-10-18 on Rey's 155U: 1/2/4/8/14 workers = 3.7/7.5/11.0/16.5/18.7 gens/s (100/100/74/55/36%). Explained by hardware: only 2 fast P-cores (4 threads), then E-cores, then low-power cores, all under a 15 W limit. Headline for the resume should use this run with its CPU named.
1. Evolution: newcomer families done 2026-10-17. Still to do: small sparse mutations; fitness-weighted average "centre" brain (Evolution Strategies style). Compare old vs new with `npm run lab` across seeds.
2. Senses and world: done 2026-10-17. Uniform grid still waiting for its trigger (creature sense doubled cost per creature-tick).
3. Game layer: poisonous food (needs a food-type sense), slow food regrowth setting, energy-cost slider, "drop food" power, rule changes applied at the next generation with a change log (replay = seed + log).
4. Page: done 2026-10-16 (drifting colours, death marks, worst-to-best band, living-only family count).
5. Later: growing brains (NEAT), continuous ecosystem mode, island model across workers.

## Stage plan (each step needs its trigger)
| Stage | Add | Trigger |
|---|---|---|
| 1 | Browser sim to watch | done |
| 2 | TypeScript engine separate from rendering, seeded and deterministic | done: the single file reached 485 lines, and comparing settings by eye was too slow |
| 3a | Experiment runs spread over worker threads (`npm run lab`, `npm run bench`) | done 2026-10-17: 900 generations took 81 s on Rey's machine, then layouts made generations 3x slower |
| 3b | One run's layouts scored in parallel (needs one random stream per layout) | Watching or running a single run is too slow |
| 4 | Job queue + multiple worker processes in Docker | One machine maxes out |
| 5 | Postgres: genomes, lineage, replay any creature | Want "show me the ancestor of the best one" |
| 6 | Live view of a server-side run over WebSocket | Want to watch a run happening on a server |

Headline scaling metric: generations per hour vs number of workers.

## Review protocol (every change)
1. Claude implements best-effort code (no deliberately planted bugs) and tests it.
2. Claude lists the design decisions in the change as a table: `# | Decision | ✓ Keep it (what happens) | ✗ Change it (the alternative and what happens)`.
   When the decisions interact or get complex, Claude first gives one short concrete scenario (named creatures, generation numbers) and the table explains each decision through that scenario.
3. Rey marks each one: ✓ agree / ✗ disagree (+ why) / ? don't know.
4. Claude then argues back or accepts each ✗ with evidence, explains each ?, and points out known weaknesses Rey marked ✓.
5. Agreed fixes get applied. Caught flaws go in a log for interviews.

## Rules
- Flags and risks first, then code.
- No speculative infrastructure: a scaling step needs a measured trigger.
- Determinism is sacred: same seed + same settings = same run. Rendering never affects the simulation.
- Mark facts as verified (with source) or unverified.
- Resume claims: design decisions, measured results, errors caught. Not "TypeScript" unless Rey wrote it.

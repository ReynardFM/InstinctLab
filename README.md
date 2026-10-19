# Evolution Lab

Creatures with tiny neural-network brains look for food. Each generation, the ones that ate the most have children with slightly mutated brains.

## Run

- **Watch it:** double-click `index.html`. Works offline, no install. It loads the already-built `dist/app.js`.
- **Check a browser replays runs exactly:** double-click `determinism.html` in that browser (about 10 s).
- **Everything else** needs Node 22.18 or newer (`node -v`):

| Command | Needs `npm install`? | What it does |
|---|---|---|
| `npm test` | no | Runs the tests, including "behaves exactly like the original browser version" |
| `npm run lab -- --gens=100 --mutation=0.05,0.15,0.4` | no | Compares settings across seeds without a browser, using all CPU cores. Prints a table and generations/second |
| `npm run bench` | no | Measures generations/second with 1, 2, 4 ... workers up to your core count (median of 3 trials), shows the CPU model and worker start-up time, and checks the results are identical. About 3 minutes on 14 cores |
| `npm run build` | yes | Rebuilds `dist/app.js` and `dist/determinism.js` after you change anything in `src/` |
| `npm run watch` | yes | Rebuilds on every save |
| `npm run typecheck` | yes | Checks the TypeScript types |
| `npm run check` | yes | Before every commit: types + tests + "is `dist/` up to date with `src/`?" |
| `npm run record-golden` | no | Re-records the runs in `test/golden.json`. Only after a change that is meant to alter behaviour |

Run `npm install` once on your own machine before using `build`, `watch` or `typecheck`.

`npm run lab` takes any rule as a comma list: `pop`, `food`, `genTicks`, `elite`, `parents`, `mutation`, `splitDistance`, `splitProof`, `championStreak`, `layouts`, `senseFood2`, `senseCreature`, `walls`, `newcomers`, `newcomerMutation`, `protectGens`, `mutationRate`, `centreShare`, `hidden`, `poison`, `regrow`, `energyCost`, `birth`, `birthEnergy`, `ageScale` (`mode` must stay 0: the lab compares generation runs), plus `--gens=N`, `--seeds=1,2,3` (default: seeds 1-7) and `--workers=N` (default: all cores). The `±95%` column shows how much the score could move by luck alone. `early` is the average over the first 30 generations (how fast it learns). `vs 1st` compares each row with the first row seed by seed: the same seed gives the same food layouts in every setting, so that luck cancels and a `*` marks a difference that is probably real. Seeds take ranges: `--seeds=1-14`. Rows print as soon as each setting finishes, so the first answers arrive early; for a quick look use `--seeds=1-7 --gens=60` (about 4x faster).

## File dependency tree

`→` = imports from. The engine never imports the page or the CLI.

```
index.html ── loads ──→ dist/app.js        (built by esbuild from src/web/main.ts)

src/web/main.ts      the page: drawing, controls, sliders
├─→ src/engine/world.ts
├─→ src/engine/brain.ts
├─→ src/engine/senses.ts  (input labels)
├─→ src/engine/space.ts   (sight lines use the same lookup)
└─→ src/engine/rng.ts

src/cli/run.ts       headless experiment runner (npm run lab)
└─→ src/cli/pool.ts  spreads runs over worker threads, results in job order
    └── starts ──→ src/cli/worker.ts   one thread: runs jobs it is sent
                   └─→ src/cli/job.ts  one run: seed + rules + generations
                       └─→ src/engine/world.ts

src/cli/bench.ts     generations/s vs number of workers (npm run bench)
├─→ src/cli/pool.ts
└─→ src/engine/world.ts   (default rules)

src/engine/world.ts  the simulation: Rules, World, createWorld, step, runGenerations, runTicks, nextGeneration
├─→ src/engine/life.ts      one tick of one creature: sense, think, move, eat, starve (both modes)
├─→ src/engine/ecosystem.ts ecosystem mode: births (split or pairs), ageing, deaths, rescue, population samples
├─→ src/engine/lineage.ts  families, branches on trial, champions, newcomers, legacy
│   └─→ src/engine/creature.ts
├─→ src/engine/creature.ts Creature, Food, newCreature, colours
│   ├─→ src/engine/senses.ts
│   └─→ src/engine/space.ts
├─→ src/engine/senses.ts  what a creature perceives each tick
│   ├─→ src/engine/space.ts   map size, wrap/walls, nearest(): the one lookup all senses use
│   └─→ src/engine/brain.ts
├─→ src/engine/breed.ts   how a child's brain is made: mutate (dense or sparse), centre brain
├─→ src/engine/brain.ts   tiny neural network: think(genome, inputs)
├─→ src/engine/dmath.ts   sin, cos, tanh, log that give identical bits in every JS engine
└─→ src/engine/rng.ts     seeded random numbers, one per World

brain.ts, rng.ts, senses.ts and world.ts all use dmath.ts instead of Math.sin/cos/tanh/log.

lineage.ts, creature.ts and senses.ts use World only as a type (no import at run time), so there is no
import loop. Other files import engine things through world.ts.

src/check/golden.ts  the recorded runs (cases) and how to compare them
└─→ src/engine/world.ts

src/web/determinism.ts  determinism.html: replays the recorded runs in a browser
├─→ src/check/golden.ts
└─→ test/golden.json

scripts/build.ts, check-dist.ts ─→ scripts/bundles.ts (list of browser bundles), esbuild
scripts/record-golden.ts        ─→ src/check/golden.ts, test/golden.json

test/engine.test.ts ─→ engine/*, src/check/golden.ts, test/golden.json
test/cli.test.ts    ─→ cli/run.ts, cli/job.ts, cli/pool.ts, cli/bench.ts, engine/world.ts
```

| File | Depends on | Used by |
|---|---|---|
| `src/engine/rng.ts` | `dmath.ts` | `world.ts`, `main.ts`, tests |
| `src/engine/breed.ts` | `dmath.ts` (types from `world.ts`, `creature.ts`) | `world.ts`, `lineage.ts`, tests |
| `src/engine/dmath.ts` | — | `brain.ts`, `rng.ts`, `senses.ts`, `world.ts`, `breed.ts`, tests |
| `src/engine/brain.ts` | `dmath.ts` | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/space.ts` | — | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/senses.ts` | `space.ts`, `brain.ts`, `dmath.ts` (types from `world.ts`, `creature.ts`) | `world.ts`, `creature.ts`, `main.ts`, tests |
| `src/engine/creature.ts` | `brain.ts`, `senses.ts`, `space.ts` (`World` type) | `world.ts`, `lineage.ts` |
| `src/engine/lineage.ts` | `creature.ts`, `breed.ts` (`World` type) | `world.ts` |
| `src/engine/world.ts` | `rng.ts`, `brain.ts`, `space.ts`, `senses.ts`, `creature.ts`, `lineage.ts`, `breed.ts`, `dmath.ts` | `main.ts`, `run.ts`, `job.ts`, `bench.ts`, tests |
| `src/web/main.ts` | engine | `dist/app.js` (build output) |
| `src/cli/job.ts` | `world.ts` | `worker.ts`, `pool.ts`, `run.ts`, `bench.ts`, `cli.test.ts` |
| `src/cli/worker.ts` | `job.ts` | `pool.ts` (started as a thread, not imported) |
| `src/cli/pool.ts` | `job.ts` (types), `worker.ts` (starts it) | `run.ts`, `bench.ts`, `cli.test.ts` |
| `src/cli/run.ts` | `world.ts`, `job.ts`, `pool.ts` | `npm run lab`, `cli.test.ts` |
| `src/cli/bench.ts` | `world.ts`, `job.ts`, `pool.ts` | `npm run bench`, `cli.test.ts` |
| `src/check/golden.ts` | `world.ts`, `rng.ts` | `engine.test.ts`, `determinism.ts`, `record-golden.ts` |
| `src/web/determinism.ts` | `golden.ts`, `golden.json` | `dist/determinism.js` (build output) |
| `scripts/*.ts` | `bundles.ts`, esbuild, `golden.ts` | `npm run build / watch / check / record-golden` |
| `test/golden.json` | — | `engine.test.ts`, `determinism.ts`, `record-golden.ts` |

Design decisions, measurements and next steps: `CLAUDE.md`.

Suggested reading order: `world.ts` → `lineage.ts` → `creature.ts` → `senses.ts` → `space.ts` → `brain.ts` → `rng.ts` → `job.ts` → `pool.ts` → `run.ts` → `main.ts`.

## Measurements

| Date | What | Result |
|---|---|---|
| 2026-10-16 | Single thread, default rules, 9 runs x 60 generations | 15.7 generations/s (cloud machine; measure on yours) |
| 2026-10-16 | Mutation 0.05 / 0.15 / 0.4, 60 generations, seeds 1-3 | score 32.4 / 34.0 / 37.1 |
| 2026-10-17 | Same brains scored on two different food layouts: how well the scores agree (1 = brain decides everything, 0 = pure luck) | 0.28. Expected 0.54 with 3 layouts, 0.66 with 5 |
| 2026-10-17 | Layouts 1 vs 3, 100 generations, seeds 1-5 | score 35.4 vs 38.0 |
| 2026-10-17 | Same compute: layouts 1 x 300 generations vs layouts 3 x 100 generations, seeds 1-5 | score 37.8 (seeds 35.1..39.8) vs 38.0 (seeds 37.2..38.4) |

| 2026-10-17 | `npm run bench` on Rey's machine (14 logical cores), 28 runs x 5 generations, one trial each | 1 / 2 / 4 / 8 / 14 workers: 5.0 / 10.6 / 19.8 / 32.0 / 39.6 gens/s. 14 workers = 7.88x (56% efficiency), 18,082 → 142,507 gens/hour, identical results |
| 2026-10-17 | `npm run bench -- --runs=8 --gens=4` on the 2-core cloud machine | 1 worker 5.7 gens/s, 2 workers 9.6 gens/s (1.70x, 85% efficiency), identical results |
| 2026-10-17 | Branch trial (`splitProof`) 0 / 1 / 2 / 3 / 5, 100 generations, seeds 1-3 | new families per 100 generations 26.0 / 19.7 / 14.0 / 10.7 / 8.0; failed trials 0 / 5.3 / 8.3 / 10.0 / 8.7; average life of dead split-off families 8.7 / 9.5 / 10.7 / 10.2 / 13.3 generations |
| 2026-10-17 | Senses, 100 generations, seeds 1-3, 3 layouts: none / 2nd food / nearest creature / both | score 37.8 / 37.5 / 44.6 / 44.8 (creature sense: seed ranges don't overlap) |
| 2026-10-17 | Walls, same setup: no walls vs walls (basic senses) | 37.8 vs 33.9 (a harder world, not a better sense) |
| 2026-10-17 | Cost per creature per tick, cloud machine, noisy (±20%) | basic ~1.1-1.4 µs (same as before senses), +2nd food ~1.4 µs, +nearest creature ~2.3 µs, everything ~2.4 µs |
| 2026-10-17 | Newcomer families, 100 generations, seeds 1-3 (score = everyone / top half, last 10 generations) | none: 44.6 / 48.7, 1.2 families alive. Mutation 1.0 + protect 3: 41.6 / 48.6, 5.3 families, 4 of 300 newcomers lasted 5+ generations past protection. Mutation 0.4 + protect 3: 41.6 / 46.5, 6.1 families, 40 of 300. Mutation 0.4, no protection: 45.0 / 49.1, 3.5 families, 40 of 300 |
| 2026-10-18 | Math functions, 200,000 random inputs each: Node 22 (V8 12.4) vs headless Chrome 141 | `sin` and `cos` give different last bits; `tanh`, `atan2`, `log`, `exp`, `sqrt` identical. The default-rules run diverges in generation 1, so the page in a new Chrome and `npm run lab` do not replay the same seed identically |
| 2026-10-18 | **Baseline, current defaults**, 7 seeds x 100 generations | score 43.2 ±2.7 (seeds 40.6..48.5), top half 47.9, 6.1 families alive, 1.6 champions per 100 generations (longest streak 4), 3.1 proven splits per 100 generations, about 2.5 generations/s on one cloud thread |
| 2026-10-18 | Deterministic math (`dmath.ts`) replaces Math.sin/cos/tanh/log | Max difference from Math.* 2e-16 (1-2 last bits). `determinism.html` in Chrome 141 now matches Node 22 on every recorded run. Speed: basic rules +23% per creature-tick (955 -> 1173 ns), default rules unchanged (1868 -> 1876 ns: dropping atan2 pays for it) |
| 2026-10-18 | Baseline again after deterministic math, same 7 seeds x 100 generations | score 42.3 ±2.8 (was 43.2 ±2.7: same within noise), top half 46.8, 6.2 families alive, 1.1 champions per 100 generations |
| 2026-10-18 | `npm run bench` on Rey's machine, new defaults, median of 3 | CPU: Intel Core Ultra 7 155U = 2 fast P-cores (4 threads) + 8 E-cores + 2 low-power E-cores, 15 W base power ([Notebookcheck](https://www.notebookcheck.net/Intel-Core-Ultra-7-155U-Processor-Benchmarks-and-Specs.783345.0.html)). 1/2/4/8/14 workers: 3.7/7.5/11.0/16.5/18.7 gens/s, efficiency 100/100/74/55/36%. Worker start-up 201 ms, so not the cause |
| 2026-10-19 | Sparse mutation (`mutationRate`) x size (`mutation`), 7 seeds x 100 generations | rate 1: 42.3 ±2.8 (0.15), 45.4 ±3.4 (0.3). Rate 0.3: 42.4 ±2.4, 43.5 ±1.4. Rate 0.1: 40.6 ±1.8, 41.6 ±1.4. None shown to differ from the default |
| 2026-10-19 | Centre brain (`centreShare`), same setup | 0: 42.3 ±2.8, 0.5: 43.0 ±2.1, 1: 40.4 ±1.2. Not shown to differ |
| 2026-10-19 | Re-comparison with learning speed, Rey's laptop (Windows), 14 workers, 7 seeds x 100 generations | learning ±95%: default 37.3 ±1.2; dense 0.3: 38.5 ±1.5; sparse 0.3 x 0.3: 38.0 ±0.6; centre 0.5: 37.4 ±1.5; sparse 0.3 x 0.15 + centre 0.5: 34.3 ±1.8 (the only one likely worse). Scores match the cloud (Linux) runs to every digit. 15.6 generations/s |
| 2026-10-19 | **Paired**, Rey's laptop, 14 seeds x 100 generations: step 0.15/0.3 x middle neurons 6/12 (vs step 0.15, 6) | score: 12 neurons -0.3 ±1.6, step 0.3 +0.8 ±1.6, both +0.4 ±1.7; early: -0.0 ±1.7, -0.3 ±1.0, +0.5 ±1.3. No difference; effects bigger than about 2 food are ruled out. Baseline 43.9 ±1.2 |
| 2026-10-19 | Hand-made greedy brain (turn to nearest food, full speed), everyone, 7 seeds | 24.3 per layout, vs 42-47 evolved |
| 2026-10-19 | Food rules, first version, Rey's laptop, 14 seeds paired: poison 0/0.3 x regrow 0/200 x energy cost 1/2 | energy x2 alone: -0.7 ±1.9 (energy is not what limits them). Regrow 200: 10.4, every seed 10.2-10.4: capped by supply (60 pellets back every 200 ticks ≈ 12 per creature per layout at most). Poison 0.3: 7.2, but this run had a bug (map filled with poison, see next row) |
| 2026-10-19 | Poison bug found and fixed | Each new pellet rolled its own kind; creatures ate the good ones and left poison, so the map filled with poison. Now: exact count per layout, eaten pellets come back as the same kind. Greedy brain with 30% poison: 4.7 -> 17.9 good food. Evolving, seed 1: 28 good vs 1.5 poison per layout by generation 30 (5% of intake vs 30% if blind) |
| 2026-10-19 | Food rules after the poison fix, Rey's laptop, 14 seeds paired | poison 0.15: -7.3 ±1.8, eats 2.5% poison (blind 15%). Poison 0.3: -12.3 ±2.0, 5.0% (blind 30%): they avoid about 5 of every 6 poison pellets. Regrow 50: -17.8 ±1.5, seeds 24.6-27.2. Both: -22.6 / -25.7. 13.3 generations/s (poison runs do more lookups) |
| 2026-10-19 | **Baseline, new defaults (30% poison)**, from Rey's run: 14 seeds x 100 generations | score 31.6 ±1.2, top half 35.5, early 21.5, poison 5.0% of intake |
| 2026-10-19 | Poison world (new defaults), quick check, cloud, 7 seeds x 60 generations, paired | 12 middle neurons -0.2 ±1.4, step 0.3 +0.8 ±2.4, both +0.3 ±2.0. No difference here either |
| 2026-10-19 | One-pass food scan (good + poison together), default rules, cloud, best of 4 | 3163 -> 1814 ns per creature-tick (1.74x). Every recorded run identical |
| 2026-10-19 | Ecosystem mode, 30,000 ticks, seeds 1-2 | Split births + regrow 100: after 1-2 extinctions, a stable population of about 40. Instant regrowth: food is unlimited and the population climbs toward the 1,000 safety limit. Two-parent births: only 3-29 births per 30,000 ticks even with a 200 px meeting range, repeated extinctions (random brains rarely get full at the same time near each other) |

Rows above 2026-10-19 (paired comparison) used one random stream for everything; since then food and starting spots have their own stream, so the same seed gives different exact numbers than before.

Rows before 2026-10-17 ran with one food layout per generation (`--layouts=1` reproduces them).

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
| `npm run record-defaults` | no | Re-records the "current defaults" run in `test/golden.json`. Only after a change that is meant to alter behaviour |

Run `npm install` once on your own machine before using `build`, `watch` or `typecheck`.

`npm run lab` takes any rule as a comma list: `pop`, `food`, `genTicks`, `elite`, `parents`, `mutation`, `splitDistance`, `splitProof`, `championStreak`, `layouts`, `senseFood2`, `senseCreature`, `walls`, `newcomers`, `newcomerMutation`, `protectGens`, plus `--gens=N`, `--seeds=1,2,3` (default: seeds 1-7) and `--workers=N` (default: all cores). The `±95%` column shows how much the score could move by luck alone.

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

src/engine/world.ts  the simulation: Rules, World, createWorld, step, runGenerations, nextGeneration
├─→ src/engine/lineage.ts  families, branches on trial, champions, newcomers, legacy
│   └─→ src/engine/creature.ts
├─→ src/engine/creature.ts Creature, Food, newCreature, colours
│   ├─→ src/engine/senses.ts
│   └─→ src/engine/space.ts
├─→ src/engine/senses.ts  what a creature perceives each tick
│   ├─→ src/engine/space.ts   map size, wrap/walls, nearest(): the one lookup all senses use
│   └─→ src/engine/brain.ts
├─→ src/engine/brain.ts   tiny neural network: think(genome, inputs)
└─→ src/engine/rng.ts     seeded random numbers, one per World

lineage.ts, creature.ts and senses.ts use World only as a type (no import at run time), so there is no
import loop. Other files import engine things through world.ts.

src/check/golden.ts  the recorded runs (cases) and how to compare them
└─→ src/engine/world.ts

src/web/determinism.ts  determinism.html: replays the recorded runs in a browser
├─→ src/check/golden.ts
└─→ test/golden.json

scripts/build.ts, check-dist.ts ─→ scripts/bundles.ts (list of browser bundles), esbuild
scripts/record-defaults.ts      ─→ src/check/golden.ts, test/golden.json

test/engine.test.ts ─→ engine/*, src/check/golden.ts, test/golden.json
test/cli.test.ts    ─→ cli/run.ts, cli/job.ts, cli/pool.ts, cli/bench.ts, engine/world.ts
```

| File | Depends on | Used by |
|---|---|---|
| `src/engine/rng.ts` | — | `world.ts`, `main.ts`, tests |
| `src/engine/brain.ts` | — | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/space.ts` | — | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/senses.ts` | `space.ts`, `brain.ts` (types from `world.ts`, `creature.ts`) | `world.ts`, `creature.ts`, `main.ts`, tests |
| `src/engine/creature.ts` | `brain.ts`, `senses.ts`, `space.ts` (`World` type) | `world.ts`, `lineage.ts` |
| `src/engine/lineage.ts` | `creature.ts` (`World` type) | `world.ts` |
| `src/engine/world.ts` | `rng.ts`, `brain.ts`, `space.ts`, `senses.ts`, `creature.ts`, `lineage.ts` | `main.ts`, `run.ts`, `job.ts`, `bench.ts`, tests |
| `src/web/main.ts` | engine | `dist/app.js` (build output) |
| `src/cli/job.ts` | `world.ts` | `worker.ts`, `pool.ts`, `run.ts`, `bench.ts`, `cli.test.ts` |
| `src/cli/worker.ts` | `job.ts` | `pool.ts` (started as a thread, not imported) |
| `src/cli/pool.ts` | `job.ts` (types), `worker.ts` (starts it) | `run.ts`, `bench.ts`, `cli.test.ts` |
| `src/cli/run.ts` | `world.ts`, `job.ts`, `pool.ts` | `npm run lab`, `cli.test.ts` |
| `src/cli/bench.ts` | `world.ts`, `job.ts`, `pool.ts` | `npm run bench`, `cli.test.ts` |
| `src/check/golden.ts` | `world.ts`, `rng.ts` | `engine.test.ts`, `determinism.ts`, `record-defaults.ts` |
| `src/web/determinism.ts` | `golden.ts`, `golden.json` | `dist/determinism.js` (build output) |
| `scripts/*.ts` | `bundles.ts`, esbuild, `golden.ts` | `npm run build / watch / check / record-defaults` |
| `test/golden.json` | — | `engine.test.ts`, `determinism.ts`, `record-defaults.ts` |

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

Rows before 2026-10-17 ran with one food layout per generation (`--layouts=1` reproduces them).

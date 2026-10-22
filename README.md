# Evolution Lab

Creatures with tiny neural-network brains look for food. Each generation, the ones that ate the most have children with slightly mutated brains.

## Run

- **Watch it:** double-click `index.html`. Works offline, no install. It loads the already-built `dist/app.js`.
- **Hall of fame (on the page):** "Save this brain" keeps the creature the brain panel follows, with its rules; "Watch" starts a run where every creature begins with it. Saved in this browser; Export / Import as a file to keep them safe.
- **Run links:** "Copy link to this moment" makes a link that rebuilds the same run (seed, changed rules, saved start brain) to the exact same step, paused. A link made from the file on disk only works on this computer; once the page is online, links work for anyone, in any browser.
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
| `npm run bench-split -- --gens=30` | no | One run with its food maps on separate threads (stage 3b) vs one after another: checks they are identical, prints the speed-up |
| `npm run queue-demo` | yes | Stage 4 check in one command: queue + Docker workers, one killed mid-run, compared with threads (below) |
| `npm run queue-status` | yes | What the queue and its workers are doing right now: waiting and running runs, lease time left, attempt numbers, live workers |
| `npm run lab -- --auto --gens=60 --mutation=0.15,0.3` | no | Like `lab`, but seeds run in batches and each setting stops once its answer is clear (real / no difference beyond `--care` / unclear after `--looks` batches) |
| `npm run lab -- --queue --gens=60 --seeds=1-14` | yes | Same as `lab`, but the runs go through a Redis queue to worker containers (stage 4, below). Same table, same numbers |

Run `npm install` once on your own machine before using `build`, `watch`, `typecheck` or `--queue` (and again after `package.json` changes).

`npm run lab` takes any rule as a comma list: `pop`, `food`, `genTicks`, `elite`, `parents`, `mutation`, `splitDistance`, `splitProof`, `championStreak`, `layouts`, `senseFood2`, `senseCreature`, `walls`, `newcomers`, `newcomerMutation`, `protectGens`, `mutationRate`, `centreShare`, `hidden`, `poison`, `regrow`, `energyCost`, `birth`, `birthEnergy`, `ageScale`, `ecoWarmup`, `learnRate`, `inheritLearned`, `thinkCost`, `learnCost`, `forget`, `relativeReward`, `energyGate`, `swapKinds`, `plasticity`, `hunters`, `hunterSense`, `hunterSpeed`, plus `--gens=N`, `--seeds=1,2,3` (default: seeds 1-7) and `--workers=N` (default: all cores). The `±95%` column shows how much the score could move by luck alone. `early` is the average over the first 30 generations (how fast it learns). `vs 1st` compares each row with the first row seed by seed: the same seed gives the same food layouts in every setting, so that luck cancels and a `*` marks a difference that is probably real. Seeds take ranges: `--seeds=1-14`. Rows print as soon as each setting finishes, so the first answers arrive early; for a quick look use `--seeds=1-7 --gens=60` (about 4x faster).

Stop when clear: `--auto` treats the `--seeds` list (default 1-7) as the first batch and adds the next seed numbers in batches of the same size, up to `--looks` batches (default 4). After each batch every open setting is judged against the first row: `real` when its range clears 0, `no difference beyond ±care` when the whole range fits inside `--care` (default 1 food), else more seeds. Each look uses a stricter bar (5% split over the looks), so looking several times doesn't raise false alarms. Real differences usually stop after 1-2 batches; "nothing" is costly to prove and often ends `unclear`.

Ecosystem mode: `npm run lab -- --mode=1 --ticks=20000 --birth=0,1` runs the warm-up generations (`ecoWarmup`), then the given ticks, and shows the population after it settles (second half of the run) ±95%, its lowest point, births and deaths per 1000 ticks, share of deaths from old age, average age, rescues (times everyone died) and `pop vs 1st` (paired). Like the page, it uses `regrow` 100 unless `--regrow` is given. Generation and ecosystem runs can't share one table.

## Stage 4: queue + Docker

Runs can go through a job queue (Redis) to worker processes in Docker containers instead of threads.
On one laptop this is not faster (same cores); it is practice for spreading work over machines, and it
survives a worker dying mid-run.

**The whole check in one command** (Docker Desktop running, after `npm install`): `npm run queue-demo`.
It starts Redis + 4 workers, sends a grid (14 runs x 60 generations) through the queue and kills one worker
container in the middle of a run (it watches Redis to see who is busy), sends the grid again with no kill
for a fair speed number, runs the same grid on 4 threads, then prints PASS/NOT A PASS, the retries, who redid
the killed run, and the time of each. About 5 minutes. `--gens=N`, `--seeds=1-14`, `--keep` (leave it running).

By hand:
1. `npm install` (adds the Redis client)
2. `docker compose up -d --build`: starts Redis and 4 workers (`--scale worker=8` for 8)
3. `npm run lab -- --queue --gens=60 --seeds=1-14`: sends the grid; prints the same table as threads,
   plus how many runs were retried
4. Kill test, while a grid runs: `docker compose ps`, then `docker kill evolution-lab-worker-2`. Its run is
   retried by another worker after 30 s without a heartbeat; the table must match the thread version exactly
5. `docker compose logs worker` shows which worker did which run and attempt; `docker compose down` stops it all

How it works: the lab puts jobs in a Redis list; a worker moves one to an "active" list, keeps a lease
alive with a heartbeat every 5 s, runs it in a thread, and stores the result. A lease that lapses (30 s)
means the worker died: the lab puts the job back, at most 3 attempts in total, then reports it as failed.
Failures are counted when they happen, so a worker that dies right after taking a job uses an attempt.
`docker stop` is not a failure: the worker hands its run back untouched and exits (20 s grace period).
Crashed workers restart on their own (`restart: unless-stopped`).
Runs are deterministic, so running one twice is harmless; a second result is checked against the first.
`npm test` tests all this against a real `redis-server` when one is installed (skipped otherwise).

## File dependency tree

`→` = imports from. The engine never imports the page or the CLI.

```
index.html ── loads ──→ dist/app.js        (built by esbuild from src/web/main.ts)
           ── loads ──→ assets/fonts/recursive.woff2  (Recursive, OFL licence next to it; works offline)

src/web/main.ts      the page: drawing, controls, sliders, hall of fame
├─→ src/web/fame.ts       hall of fame: reading, merging and storing saved brains
├─→ src/web/share.ts      run links: seed, changed rules, steps and start brain in the address
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

src/queue/redis-queue.ts  stage 4: the Redis job queue; the lab's side (send jobs, collect, retry) (run.ts --queue)
└─→ src/cli/job.ts (types)
src/queue/worker-main.ts  one queue worker = one Docker container (Dockerfile, compose.yaml)
├─→ src/queue/redis-queue.ts
└── starts ──→ src/cli/worker.ts   the run happens in a thread, so the heartbeat keeps going

src/cli/split.ts     stage 3b: one run's food maps on separate threads, same numbers
└── starts ──→ src/cli/layout-worker.ts   one thread: plays one food map of one generation
src/cli/split-bench.ts  npm run bench-split: one run split vs not, identical check, speed-up

src/cli/stats.ts     exact t distribution, margins, the --auto stop rule (decide)

src/cli/bench.ts     generations/s vs number of workers (npm run bench)
├─→ src/cli/pool.ts
└─→ src/engine/world.ts   (default rules)

src/engine/world.ts  the simulation: Rules, World, createWorld, step, runGenerations, runTicks, nextGeneration
├─→ src/engine/life.ts      one tick of one creature: sense, think, move, eat, starve (both modes)
├─→ src/engine/ecosystem.ts ecosystem mode: births (split or pairs), ageing, deaths, rescue, population samples
├─→ src/engine/hunters.ts   dumb hunters (rules.hunters): chase the nearest prey, catch, rest
├─→ src/engine/mode.ts      inEcosystem(): which mode is running (ecosystem starts after its warm-up generations)
├─→ src/engine/lineage.ts  families, branches on trial, champions, newcomers, legacy
│   └─→ src/engine/creature.ts
├─→ src/engine/creature.ts Creature, Food, newCreature, colours
│   ├─→ src/engine/senses.ts
│   └─→ src/engine/space.ts
├─→ src/engine/senses.ts  what a creature perceives each tick (grid search in big worlds)
│   ├─→ src/engine/space.ts   map size, wrap/walls, nearest(), and the Grid for big worlds
│   └─→ src/engine/brain.ts
├─→ src/engine/breed.ts   how a child's brain is made: mutate (dense or sparse), centre brain
├─→ src/engine/brain.ts   tiny neural network: think(genome, inputs)
├─→ src/engine/dmath.ts   sin, cos, tanh, log that give identical bits in every JS engine
└─→ src/engine/rng.ts     seeded random numbers, one per World

brain.ts, breed.ts, life.ts, rng.ts, senses.ts and world.ts use dmath.ts instead of Math.sin/cos/tanh/log.

The engine's run-time imports form no loop (checked 2026-10-20): files below world.ts use World only as a
type. Other files import engine things through world.ts.

src/check/golden.ts  the recorded runs (cases) and how to compare them
└─→ src/engine/world.ts

src/web/determinism.ts  determinism.html: replays the recorded runs in a browser
├─→ src/check/golden.ts
└─→ test/golden.json

scripts/build.ts, check-dist.ts ─→ scripts/bundles.ts (list of browser bundles), esbuild
scripts/record-golden.ts        ─→ src/check/golden.ts, test/golden.json
scripts/queue-demo.ts           ─→ src/queue/redis-queue.ts, src/cli/pool.ts, docker compose
scripts/queue-status.ts         ─→ src/queue/redis-queue.ts

test/engine.test.ts ─→ engine/*, src/check/golden.ts, test/golden.json
test/cli.test.ts    ─→ cli/run.ts, cli/job.ts, cli/pool.ts, cli/bench.ts, engine/world.ts
test/stats.test.ts  ─→ cli/stats.ts: t values vs scipy, stop rule simulated (false alarms <= 5%)
test/grid.test.ts   ─→ engine/space.ts, engine/senses.ts, golden: grid search = brute force
test/split.test.ts  ─→ cli/split.ts, engine/world.ts: split = one after another
test/queue.test.ts  ─→ queue/redis-queue.ts, queue/worker-main.ts (as processes), cli/pool.ts; needs redis-server
```

| File | Depends on | Used by |
|---|---|---|
| `src/engine/rng.ts` | `dmath.ts` | `world.ts`, `main.ts`, tests |
| `src/engine/breed.ts` | `dmath.ts` (types from `world.ts`, `creature.ts`) | `world.ts`, `lineage.ts`, tests |
| `src/engine/dmath.ts` | — | `brain.ts`, `rng.ts`, `senses.ts`, `world.ts`, `breed.ts`, tests |
| `src/engine/brain.ts` | `dmath.ts` | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/space.ts` | — | `world.ts`, `senses.ts`, `main.ts`, tests |
| `src/engine/senses.ts` | `space.ts`, `brain.ts`, `dmath.ts` (types from `world.ts`, `creature.ts`) | `world.ts`, `life.ts`, `creature.ts`, `main.ts`, tests |
| `src/engine/creature.ts` | `brain.ts`, `senses.ts`, `space.ts` (`World` type) | `world.ts`, `lineage.ts`, `life.ts`, `ecosystem.ts` |
| `src/engine/life.ts` | `brain.ts`, `creature.ts`, `senses.ts`, `space.ts`, `dmath.ts` | `world.ts`, `ecosystem.ts` |
| `src/engine/ecosystem.ts` | `life.ts`, `creature.ts`, `lineage.ts`, `breed.ts`, `space.ts` | `world.ts` |
| `src/engine/mode.ts` | — (`World` type) | `world.ts`, `lineage.ts`, `main.ts` |
| `src/engine/lineage.ts` | `creature.ts`, `breed.ts`, `mode.ts` (`World` type) | `world.ts`, `ecosystem.ts` |
| `src/engine/world.ts` | `rng.ts`, `brain.ts`, `space.ts`, `senses.ts`, `creature.ts`, `lineage.ts`, `breed.ts`, `life.ts`, `ecosystem.ts`, `mode.ts`, `dmath.ts` | `main.ts`, `run.ts`, `job.ts`, `bench.ts`, tests |
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
| 2026-10-19 | Ecosystem after 20 warm-up generations, 30,000 ticks, seeds 1-3 | No extinctions. Split births: population 37-63. Two-parent births: 20-46, about 440 births per 30,000 ticks (was 3-29 without warm-up) |
| 2026-10-19 | Learning during life (reward-modulated Hebbian, children inherit 75%), cloud, 7 seeds x 60 generations, paired | learnRate 0.001 / 0.005 / 0.02: -17.2 ±9.7, -17.6 ±10.8, -21.5 ±10.4 (some seeds collapse to near 0). Cost: +24% per creature-tick when on, nothing when off |
| 2026-10-19 | Why learning hurts, seeds 1-3, 30 generations | With 75% inherited, the average weight size grows 0.40 -> 5-22 (no learning: 0.40 -> 0.8): learned changes pile up across generations until the brain saturates. Without inheritance it still costs about 7 food (21.5 vs 28.5): food rewards come far more often than poison, so the rule mostly strengthens whatever happens to be active |
| 2026-10-19 | Learning fixed: forgetting (0.002/tick back toward the inborn brain) + reward relative to usual intake, seeds 1-3, 30 generations | Weights stay normal (0.9 at gen 30, same as no learning). Either fix alone still grows them 3-6x (forgetting only 2.8-3.5, relative only 4.7-5.0) |
| 2026-10-19 | Fixed learning, 7 seeds x 60 generations, paired vs no learning (30.1) | learnRate 0.001: +1.0 ±1.8 (no difference); 0.005: -2.4 ±1.4 *; 0.02: -11.7 ±5.1 *. No more collapses (was -17 to -21). Learning now harmless at low rates but doesn't help yet |
| 2026-10-19 | Rey's energy gate (learn less when hungry), learnRate 0.005, paired | +0.7 ±3.3: no effect |
| 2026-10-19 | Swap world (poison 0.5, which look is poison flips by coin on each food map), 7 seeds x 60 generations, paired vs no learning (10.7) | learnRate 0.001: +1.2 ±1.9; 0.005: -0.9 ±2.7; 0.02: -5.4 ±2.0 *. Learning still doesn't help. Non-learners eat only 17% poison, not by avoiding it: they commit to one look and die after 2-3 poisons on the bad maps. Hiding the energy sense changes nothing (17.6%), so it isn't used as a memory |
| 2026-10-19 | Same, gentler poison (0.15 instead of 0.5 energy) so learners survive more lessons | 0.001: +0.1 ±1.7; 0.005: -2.2 ±2.8; 0.02: -2.9 ±1.3 *. Still no gain: the learning rule itself is too weak, not the number of lessons. Inheriting learned changes in the swap world: 0 vs 0.75 = +1.4 ±3.3 (no difference) |
| 2026-10-19 | Swap world repeated on Rey's laptop, 14 seeds x 60 generations, paired vs no learning (10.3) | learnRate 0.001: +0.4 ±2.2; 0.005: -0.9 ±2.0; 0.02: -4.6 ±1.8 *. Confirms the 7-seed cloud run. 3360 generations in 180 s (18.7/s, 14 workers) |
| 2026-10-19 | Evolved per-connection learning rates (plasticity 1), swap world, 7 seeds x 60 generations, paired vs no learning (10.7) | No gain: plasticity alone -0.1 ±2.7, with learnRate 0.005 -1.0 ±3.7, with 0.02 -1.5 ±2.1 (vs -5.4 * for one shared rate). Evolution used the control to cancel harmful learning, not to learn the swap (likely; rates not inspected). Learning closed here, time-boxed per Rey's call |
| 2026-10-19 | Per-connection learning rates repeated on Rey's laptop, 14 seeds x 60 generations, paired vs no learning (10.3) | Plasticity alone +0.8 ±2.2; learnRate 0.005: -0.9 (shared) / -0.2 (per-connection); 0.02: -4.6 * (shared) / -1.2 ±1.4 (per-connection). Confirms the 7-seed run: no gain, per-connection rates only cancel the harm. 5040 generations in 252 s (20.0/s, 14 workers) |
| 2026-10-20 | Stage 4 on Rey's laptop: `npm run queue-demo`, 14 runs x 60 generations, Redis + 4 worker containers, one container killed 3 s into a run | PASS: the killed run was redone by another worker on attempt 2; both queue passes identical to threads, number for number. Times: queue with the kill 177 s (incl. the 30 s lease wait), queue 130.5 s (6.4 gens/s), 4 threads 152.0 s (5.5 gens/s). Queue 1.16x threads in this one trial: threads ran last (heat/power limit on a 15 W laptop is a likely reason, unverified); expected about equal on the same cores |
| 2026-10-21 | Stage 3b: each food map gets its own random numbers and starts everyone fresh (golden re-recorded), default rules, seeds 1-7 x 60 generations, cloud | Same behaviour: 29.6 ±1.7 food (before 30.1 ±1.3), poison 5.2% (5.4%). Older rows were measured before this change: same trends, not the same digits |
| 2026-10-21 | `npm run bench-split -- --gens=20`, 2-core cloud machine | 1.56x on 2 threads (1.5x is the ceiling for 3 maps on 2 cores), 1.50x on 3 threads; identical results. Rey's laptop: to measure (at most 3x) |
| 2026-10-21 | Profile, share of run time in the senses (food scan + nearest creature) | default world ~49%; 200 food + 200 creatures ~84%; ecosystem at ~390 creatures ~82% |
| 2026-10-21 | Grid search (100 px squares) vs checking everything, 2-core cloud | First version with callbacks: 0.39x at default sizes (slower). Plain loops: food grid 0.84x at 100 pellets, 1.22x at 150, 2.37x at 300; creature grid 0.82x at 40, 1.10x at 80, 1.88x at 300. Switched on from 128 pellets / 64 creatures: default 1.01x (unchanged), 200 + 200 world 2.04x, ecosystem to ~390 creatures 2.34x. Identical results |
| 2026-10-21 | Hot loop without per-tick garbage (buffers reused), cloud, median of 5 | default 4 generations 2.23 -> 1.57 s (1.42x); all senses + walls 1.39 -> 1.06 s (1.31x); 200 + 200 world 2.83 -> 2.57 s (1.10x). Identical results. Left: food search 24%, brain 21%, sense maths 20%, GC 4.6% |
| 2026-10-21 | `--auto` stop rule simulated 4000x per case (difference spread 2, care 1, 4 looks of 7 seeds) | no true difference: called real 3.1% (<= 5%), none 11.9%, unclear 85% (27.4 seeds); true 1.5: real 90.5% (17.8 seeds), wrongly none 0.1%; true 2: real 99.3% (13.6 seeds) |
| 2026-10-21 | `--auto --gens=30 --seeds=1-7 --senseCreature=1,0`, cloud | decided after the first batch: real -1.9 ±1.7; 14 runs instead of 56 (25%) |
| 2026-10-21 | Predators cheapest test: 8 dumb hunters (speed 2), 7 seeds x 30 generations, with vs without the prey's hunter sense, cloud | With the sense, caught on 82.9% of maps in gens 1-5 -> 69.0% in gens 26-30 (drop 13.9 ±8.5: prey learn to flee); without it 93.8% -> 94.5%. Gens 21-30, with minus without: -27.8 ±11.0 points, lower in all 7 seeds. Food about the same (8.9 vs 8.8). 11.2 generations/s (maps end early when everyone is caught) |
| 2026-10-21 | Rey's laptop: `npm run bench-split -- --gens=30` (one run, seed 1) | maps one after another 14.8 s (2.03 gens/s), maps on 3 threads 4.9 s (6.18 gens/s): 3.04x, identical. The ceiling is 3x (3 maps); the extra 0.04 is noise (the one-after-another run goes first, cold) |
| 2026-10-21 | Rey's laptop: new baseline after stage 3b, default rules, 14 seeds x 100 generations | score 32.2 ±1.3, top half 36.0, early 20.9 ±0.9, poison 4.7% of intake, seeds 27.5..35.3 (before 3b: 31.6 ±1.2; same within noise). 1400 generations in 114.7 s (12.2 gens/s, 14 workers) |
| 2026-10-21 | Rey's laptop: npm run check, determinism.html, queue-demo after hardening, page (hall of fame, run link, hunters) | all pass |
| 2026-10-21 | Hunter tuning, 2/4/8 hunters x speed 1.5/2, sense vs no sense, 7 seeds x 30 generations | The sense never raised food (8 hunters at 1.5: -2.0 ±1.7 *). Unfair control: no sense = a smaller brain, which learns to forage faster |
| 2026-10-21 | Same with a fair blind control (hunterSense 2: same inputs, always empty), 60 generations | sense minus blind: 4/1.5 +1.0 ±2.6, 4/2 +1.6 ±1.7, 8/2 +1.1 ±1.5; caught 53/61/68% with the sense vs 66/78/93% blind |
| 2026-10-21 | `--auto`, 4 hunters at speed 2, blind vs sense, 60 generations | real after 14 seeds: +1.4 ±1.2 food; caught 62.6% vs 78.1%; 28 runs instead of 56 |

Rows above 2026-10-19 (paired comparison) used one random stream for everything; since then food and starting spots have their own stream, so the same seed gives different exact numbers than before.

Rows before 2026-10-17 ran with one food layout per generation (`--layouts=1` reproduces them).

// Stage 3b measurement: one run, maps one after another vs maps on separate threads.
//   npm run bench-split -- --gens=30 --threads=3 --seed=1
// Checks the two runs are identical and prints the speed-up.
import { deepStrictEqual } from "node:assert";
import { createWorld, runGenerations, DEFAULT_RULES } from "../engine/world.ts";
import { LayoutPool, runGenerationsSplit } from "./split.ts";

const arg = (name: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? d);
const gens = arg("gens", 30);
const threads = arg("threads", DEFAULT_RULES.layouts);
const seed = arg("seed", 1);

console.log(`one run, seed ${seed}, ${gens} generations, ${DEFAULT_RULES.layouts} food maps per generation`);
let t0 = performance.now();
const one = createWorld(seed, DEFAULT_RULES);
runGenerations(one, gens);
const oneSecs = (performance.now() - t0) / 1000;
console.log(`  maps one after another: ${oneSecs.toFixed(1)} s (${(gens / oneSecs).toFixed(2)} generations/s)`);

const pool = new LayoutPool(threads);
t0 = performance.now();
const split = createWorld(seed, DEFAULT_RULES);
await runGenerationsSplit(split, gens, pool);
const splitSecs = (performance.now() - t0) / 1000;
await pool.close();
console.log(`  maps on ${threads} threads:   ${splitSecs.toFixed(1)} s (${(gens / splitSecs).toFixed(2)} generations/s)`);

deepStrictEqual(split.avgHist, one.avgHist);
deepStrictEqual(split.creatures.map((c) => c.g), one.creatures.map((c) => c.g));
console.log(`  identical: yes. speed-up ${(oneSecs / splitSecs).toFixed(2)}x (at most ${Math.min(threads, DEFAULT_RULES.layouts)}x)`);

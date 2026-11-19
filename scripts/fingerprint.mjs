// Fingerprints of eye-world runs (run from a repo root): the same hashes before and after a speed-up = bit-identical results.
import { createHash } from "node:crypto";
const R = process.cwd();
const { createWorld, runTicks, runGenerations, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const LIFE = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, hunterCue: 2, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1 };
const fp = (w) => createHash("sha256").update(JSON.stringify({ p: w.eco.popHist, h: w.eco.hunterPopHist, c: w.eco.caught, b: w.eco.births, d: w.eco.dose, a: w.avgHist,
  food: w.food.map((f) => [f.x, f.y, f.poison, f.readyAt === Infinity ? -1 : f.readyAt]), cr: w.creatures.map((c) => [c.x, c.y, c.energy, c.toxin, c.eaten, c.poisoned, ...c.g]), hu: w.hunters.map((h) => [h.x, h.y, h.energy, h.toxin, ...(h.brain ? h.brain.g : [])]) })).digest("hex").slice(0, 16);
const life = (name, extra, ticks, seeds = [1, 2]) => { for (const s of seeds) { const w = createWorld(s, { ...LIFE, ...extra }); runTicks(w, ticks); console.log(`${name} s${s} ${fp(w)} prey ${w.creatures.length} hunters ${w.hunters.length}`); } };
life("glow-same", {}, 4000);
life("food120", { food: 120 }, 2500);
life("season", { season: 2000 }, 4000);
life("bite", { hunterBite: 1 }, 3000);
life("genes", { senseGenes: 1, senseCost: 0.0002 }, 3000);
life("remains", { remains: 300 }, 3000);
life("walls", { walls: 1 }, 3000);
life("eye8", { eye: 8, hunterEye: 8 }, 2500);
life("oldhunters-speed", { hunterEye: 0, hunterCue: 1 }, 3000);
life("harmless-default-stats", { poisonDose: 0, hunterMature: 1000, hunterBirth: 1.4, hunterBirthChance: 0.03 }, 3000);
for (const [name, extra] of [["gens-eye", { eye: 4, genTicks: 400 }], ["gens-eye-swap-learn", { eye: 4, genTicks: 400, swapKinds: 1, poison: 0.5, learnRate: 0.005 }], ["gens-eye-hunters", { eye: 4, genTicks: 400, hunters: 6, hunterBrains: 1 }], ["gens-eye-regrow0-walls", { eye: 4, genTicks: 400, walls: 1, layouts: 2 }]]) {
  const w = createWorld(3, { ...DEFAULT_RULES, ...extra }); runGenerations(w, 3); console.log(`${name} ${fp(w)}`);
}

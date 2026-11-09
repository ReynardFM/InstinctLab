// Season check (Rey 2026-11-09, counting only): what a year does. Every 1,000 ticks: poison share of the plants, prey, sick share of prey,
// hunters.   node scripts/season-check.mjs [seed] [ticks] [--rule=value ...]   (default world + prey-like hunter breeding is NOT assumed)
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const { seasonFactor } = await import(`${R}/src/engine/plants.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const [seed, T] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 30000)];
const extra = Object.fromEntries(process.argv.slice(4).map((a) => /^--(\w+)=(.+)$/.exec(a)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, ...extra };
const w = createWorld(seed, rules);
const rows = { clean: [], poison: [] };
for (let t = 0; t < T; t += 1000) {
  runTicks(w, 1000);
  const plants = w.food.filter((f) => !f.remains), alive = w.creatures.filter((c) => c.alive);
  const row = { plantPoison: plants.filter((f) => f.poison).length / plants.length, plants: plants.length, prey: alive.length, sick: alive.length ? alive.filter((c) => c.toxin > SICK).length / alive.length : NaN, hunters: w.hunters.length };
  (seasonFactor(w) < 1 ? rows.clean : rows.poison).push(row);
}
const avg = (xs, k) => { const v = xs.map((r) => r[k]).filter(Number.isFinite); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "n/a"; };
for (const s of ["clean", "poison"]) console.log(`${s} season (${rows[s].length} samples): poison share of plants ${avg(rows[s], "plantPoison")}, plants ${avg(rows[s], "plants")}, prey ${avg(rows[s], "prey")}, sick share of prey ${avg(rows[s], "sick")}, hunters ${avg(rows[s], "hunters")}`);
console.log(`die-out rounds ${w.eco.rounds.length} (${["prey", "hunters", "both"].map((d) => d + " " + w.eco.rounds.filter((r) => r.died === d).length).join(", ")}), prey restarts ${w.eco.rescues}, ${JSON.stringify(extra)}`);

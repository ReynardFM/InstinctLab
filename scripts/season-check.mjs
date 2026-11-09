// Season check (Rey 2026-11-09, counting only): what a year does, per season. Every 500 ticks: poison share of the plants, prey, sick
// share of prey, hunters, and the share of plants / prey / hunters standing in the farm zones.
//   node scripts/season-check.mjs [seed] [ticks] [--rule=value ...]   (pass --season=40000 for 10k-tick seasons)
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const { seasonQuarter, SEASON_NAMES, FARMS, FARM_R } = await import(`${R}/src/engine/plants.ts`);
const { offset, W, H } = await import(`${R}/src/engine/space.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const [seed, T] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 40000)];
const extra = Object.fromEntries(process.argv.slice(4).map((a) => /^--(\w+)=(.+)$/.exec(a)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, ...extra };
const w = createWorld(seed, rules);
const walls = rules.walls > 0;
const inFarm = (o) => { const f = w.eco.farms; for (let k = 0; 2 * k < f.length; k++) { const dx = offset(o.x - f[2 * k], W, walls), dy = offset(o.y - f[2 * k + 1], H, walls); if (dx * dx + dy * dy <= FARM_R * FARM_R) return true; } return false; };
const rows = [[], [], [], [], []];
let caughtBefore = 0, roundsBefore = 0;
for (let t = 0; t < T; t += 500) {
  runTicks(w, 500);
  const plants = w.food.filter((f) => !f.remains), alive = w.creatures.filter((c) => c.alive), q = seasonQuarter(w);
  const sh = (xs) => (xs.length && w.eco.farms.length ? xs.filter(inFarm).length / xs.length : NaN);
  rows[q < 0 ? 4 : q].push({ plantPoison: plants.filter((f) => f.poison).length / plants.length, prey: alive.length, sick: alive.length ? alive.filter((c) => c.toxin > SICK).length / alive.length : NaN,
    hunters: w.hunters.length, plantsIn: sh(plants), preyIn: sh(alive), huntersIn: sh(w.hunters), catches: w.eco.caught - caughtBefore, dieouts: w.eco.rounds.length - roundsBefore });
  caughtBefore = w.eco.caught; roundsBefore = w.eco.rounds.length;
}
const avg = (xs, k) => { const v = xs.map((r) => r[k]).filter(Number.isFinite); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "n/a"; };
const sum = (xs, k) => xs.reduce((a, r) => a + r[k], 0);
[...SEASON_NAMES, "no season"].forEach((name, q) => { const x = rows[q]; if (!x.length) return;
  console.log(`${name.padEnd(16)} poison plants ${avg(x, "plantPoison")} | prey ${avg(x, "prey")} sick ${avg(x, "sick")} | hunters ${avg(x, "hunters")} | in farm zones: plants ${avg(x, "plantsIn")}, prey ${avg(x, "preyIn")}, hunters ${avg(x, "huntersIn")} | catches ${sum(x, "catches")}, die-outs ${sum(x, "dieouts")}`); });
console.log(`farm zones cover ${(100 * FARMS * Math.PI * FARM_R * FARM_R / (W * H)).toFixed(0)}% of the map | total die-out rounds ${w.eco.rounds.length} (${["prey", "hunters", "both"].map((d) => d + " " + w.eco.rounds.filter((r) => r.died === d).length).join(", ")}), prey restarts ${w.eco.rescues}, ${JSON.stringify(extra)}`);

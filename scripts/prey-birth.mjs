// Prey births (Rey 2026-11-07, counting only): age at first birth and share of prey that ever breed. Detects a split as an energy
// drop to below 60% in one tick.   node scripts/prey-birth.mjs   (seed 1, poison on, 15k)
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1 };
const w = createWorld(1, rules);
const first = new WeakMap(), firstAges = [], deathAges = [], kids = new WeakMap(), kidCounts = [];
let prev = new Map();
for (let t = 0; t < 15000; t++) {
  runTicks(w, 1);
  const now = new Map(w.creatures.filter((c) => c.alive).map((c) => [c, c.energy]));
  for (const [c, e] of prev) {
    if (!now.has(c)) { if (t > 3000) { deathAges.push(c.age); kidCounts.push(kids.get(c) ?? 0); } continue; }
    if (e >= 0.85 && now.get(c) < e * 0.65) { kids.set(c, (kids.get(c) ?? 0) + 1); if (!first.has(c)) { first.set(c, c.age); if (t > 3000) firstAges.push(c.age); } }
  }
  prev = now;
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : "n/a"; };
console.log(`prey (seed 1, poison, 15k): age at first birth median ${q(firstAges, .5)}, p10 ${q(firstAges, .1)}, p90 ${q(firstAges, .9)} (n ${firstAges.length}) | age at death median ${q(deathAges, .5)} | share of dead prey that ever bred ${Math.round(100 * kidCounts.filter((k) => k > 0).length / kidCounts.length)}% | births per prey median ${q(kidCounts, .5)}`);

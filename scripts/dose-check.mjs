// Dose check (Rey 2026-11-06, counting only): why one caught prey gives a hunter so much poison. Prints the prey dose per pellet
// (1 / age resistance), sick prey poison levels, and the hunter age multiplier.   node scripts/dose-check.mjs [seed]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK, resistance, preyLife } = await import(`${R}/src/engine/toxin.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, hunterCue: 2 };
const w = createWorld(Number(process.argv[2] ?? 1), rules);
const tox = [], perPellet = [], hdiv = [], pellets = [];
for (let t = 0; t < 12000; t += 20) {
  runTicks(w, 20);
  if (t < 3000) continue;
  for (const c of w.creatures) { if (!c.alive) continue; perPellet.push(1 / resistance(c.age, preyLife(w), rules.poisonFrail)); if (c.toxin > SICK) { tox.push(c.toxin); pellets.push(c.poisoned); } }
  for (const h of w.hunters) hdiv.push(1 / resistance(h.age, rules.hunterAge, rules.poisonFrail));
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))].toFixed(2); };
console.log(`prey dose per pellet (1/resistance): median ${q(perPellet, .5)}, p90 ${q(perPellet, .9)}, max ${q(perPellet, 1)}`);
console.log(`sick prey poison level: median ${q(tox, .5)}, p90 ${q(tox, .9)} | poison pellets eaten in life (sick prey): median ${q(pellets, .5)}`);
console.log(`hunter multiplier (1/resistance by age): median ${q(hdiv, .5)}, p10 ${q(hdiv, .1)}, p90 ${q(hdiv, .9)} | preyLife ${preyLife(w).toFixed(0)}, hunterAge ${rules.hunterAge}`);
console.log(`=> hunter dose from a median sick prey: ${(Number(q(tox, .5)) * Number(q(hdiv, .5))).toFixed(2)}`);

// Cue check (Rey 2026-11-06, counting only): in a real run with rules.hunterCue = cue, how well does the cue a hunter reads for its
// NEAREST prey (glow for 2, speed / 3 for 1) tell whether that prey is sick? AUC: 1 = perfect, 0.5 = none. (Scent and the shuffled
// controls were deleted 2026-11-19.)
//   node scripts/cue-check.mjs [cue] [seed] [ticks]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const { glowShown } = await import(`${R}/src/engine/hunters.ts`);
const { eyeSlice } = await import(`${R}/src/engine/senses.ts`);
const { offset, W, H } = await import(`${R}/src/engine/space.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const cue = Number(process.argv[2] ?? 2), seed = Number(process.argv[3] ?? 1), T = Number(process.argv[4] ?? 8000);
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, hunterCue: cue };
const w = createWorld(seed, rules);
const walls = rules.walls > 0, rows = [];
for (let t = 0; t < T; t += 10) {
  runTicks(w, 10);
  if (t < 3000) continue;
  for (const h of w.hunters) {
    let bi = -1, bd = Infinity;
    w.creatures.forEach((c, i) => { if (!c.alive) return; const dx = offset(c.x - h.x, W, walls), dy = offset(c.y - h.y, H, walls), d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; bi = i; } });
    if (bi < 0) continue;
    const c = w.creatures[bi];
    const v = cue === 1 ? Math.min(c.speed / 3, 1) : glowShown(w, bi);
    rows.push({ v, sick: c.toxin > SICK });
  }
}
const sick = rows.filter((r) => r.sick).map((r) => r.v), ok = rows.filter((r) => !r.sick).map((r) => r.v).sort((a, b) => a - b);
let s = 0;
for (const v of sick) { let lo = 0, hi = ok.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ok[m] < v) lo = m + 1; else hi = m; } let lo2 = lo, hi2 = ok.length; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (ok[m] <= v) lo2 = m + 1; else hi2 = m; } s += lo + 0.5 * (hi2 - lo); }
const auc = s / (sick.length * ok.length); // chance a sick prey's cue is HIGHER than a clean one's (speed: lower = sick, so read 1 - this)
console.log(`cue ${cue} seed ${seed}: nearest-prey samples ${rows.length} (sick ${sick.length}) | AUC sick shows MORE ${auc.toFixed(2)}${cue === 1 ? ` (speed: sick slower = ${(1 - auc).toFixed(2)})` : ""}`);

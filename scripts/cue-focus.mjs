// Focus vs slice (Rey 2026-11-06, counting only): for each hunter, how well does the speed of the NEAREST prey ("focus") vs the
// closeness-weighted mean speed of ALL prey in the nearest prey's eye slice (the best a brain could do from the hunter eye sums)
// tell whether the nearest prey is sick? AUC: 0.5 = no information, 1 = perfect, below 0.5 = inverted.
//   node scripts/cue-focus.mjs [seed] [ticks]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const { eyeSlice, EYE_R2 } = await import(`${R}/src/engine/senses.ts`);
const { offset } = await import(`${R}/src/engine/space.ts`);
const { W, H } = await import(`${R}/src/engine/space.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const seed = Number(process.argv[2] ?? 1), T = Number(process.argv[3] ?? 9000), K = 4;
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1 };
const w = createWorld(seed, rules);
const walls = rules.walls > 0, rows = [];
for (let t = 0; t < T; t += 10) {
  runTicks(w, 10);
  if (t < 3000) continue;
  for (const h of w.hunters) {
    if (!h.brain) continue;
    const cosH = Math.cos(h.brain.a), sinH = Math.sin(h.brain.a);
    const pres = new Array(K).fill(0), mot = new Array(K).fill(0);
    let best = null;
    for (const c of w.creatures) {
      if (!c.alive) continue;
      const dx = offset(c.x - h.x, W, walls), dy = offset(c.y - h.y, H, walls), d2 = dx * dx + dy * dy;
      if (d2 >= EYE_R2) continue;
      const v = 1 - d2 / EYE_R2, sl = eyeSlice(dx, dy, cosH, sinH, K), m = Math.min(c.speed / 3, 1);
      pres[sl] += v; mot[sl] += v * m;
      if (!best || d2 < best.d2) best = { d2, sl, m, sick: c.toxin > SICK };
    }
    if (best) rows.push({ focus: best.m, slice: mot[best.sl] / pres[best.sl], sick: best.sick, near: best.d2 < 2500 });
  }
}
function auc(rs, key) {
  const sick = rs.filter((r) => r.sick).map((r) => r[key]), ok = rs.filter((r) => !r.sick).map((r) => r[key]);
  if (!sick.length || !ok.length) return NaN;
  ok.sort((a, b) => a - b);
  let s = 0;
  for (const v of sick) { let lo = 0, hi = ok.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ok[m] < v) lo = m + 1; else hi = m; } let lo2 = lo, hi2 = ok.length; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (ok[m] <= v) lo2 = m + 1; else hi2 = m; } s += (ok.length - hi2) + 0.5 * (hi2 - lo); }
  return s / (sick.length * ok.length);
}
const nS = rows.filter((r) => r.sick).length, nN = rows.filter((r) => r.near);
console.log(`seed ${seed}: hunter-ticks ${rows.length} (nearest prey sick ${nS}) | focus AUC ${auc(rows, "focus").toFixed(2)} | slice-mean AUC ${auc(rows, "slice").toFixed(2)} | within 50px: focus ${auc(nN, "focus").toFixed(2)}, slice ${auc(nN, "slice").toFixed(2)} (n ${nN.length})`);

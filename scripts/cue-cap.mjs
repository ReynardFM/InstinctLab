// Cue with a straight debuff (Rey 2026-11-06 idea, counting only, NOT the real rule): if sick prey had a fixed top-speed cap instead of
// speed / (1 + poison), how well would one speed reading tell sick from not sick? Sick speed is rebuilt as min(throttle, cap), throttle =
// speed x (1 + poison) (prey resist is 0). Approximate: prey behaviour would adapt to a real cap. AUC as in cue-quality.mjs.
//   node scripts/cue-cap.mjs [seed] [ticks]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const seed = Number(process.argv[2] ?? 1), T = Number(process.argv[3] ?? 12000);
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1 };
const w = createWorld(seed, rules);
const pts = [];
for (let t = 0; t < T; t += 10) {
  runTicks(w, 10);
  if (t < 3000) continue;
  for (const c of w.creatures) {
    if (!c.alive) continue;
    let near = false;
    for (const h of w.hunters) { const dx = c.x - h.x, dy = c.y - h.y; if (dx * dx + dy * dy < 2500) { near = true; break; } }
    pts.push({ v: c.speed, thr: c.speed * (1 + c.toxin), sick: c.toxin > SICK, near });
  }
}
function auc(rs, sp) {
  const sick = rs.filter((r) => r.sick).map(sp), ok = rs.filter((r) => !r.sick).map(sp);
  if (!sick.length || !ok.length) return NaN;
  ok.sort((a, b) => a - b);
  let s = 0;
  for (const v of sick) { let lo = 0, hi = ok.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ok[m] < v) lo = m + 1; else hi = m; } let lo2 = lo, hi2 = ok.length; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (ok[m] <= v) lo2 = m + 1; else hi2 = m; } s += (ok.length - hi2) + 0.5 * (hi2 - lo); }
  return s / (sick.length * ok.length);
}
const ok = pts.filter((p) => !p.sick).map((p) => p.v);
const below = (x) => ok.filter((v) => v <= x).length / ok.length;
const cap = (c) => (p) => (p.sick ? Math.min(p.thr, c) : p.v);
const nh = pts.filter((p) => p.near);
const f = (x) => x.toFixed(2);
console.log(`seed ${seed}: now ${f(auc(pts, (p) => p.v))} | cap 50% (1.5) ${f(auc(pts, cap(1.5)))} | cap 25% (0.75) ${f(auc(pts, cap(0.75)))} || near hunters: now ${f(auc(nh, (p) => p.v))}, 50% ${f(auc(nh, cap(1.5)))}, 25% ${f(auc(nh, cap(0.75)))} || healthy prey at or below 0.75: ${Math.round(100 * below(0.75))}%, below 1.5: ${Math.round(100 * below(1.5))}%`);

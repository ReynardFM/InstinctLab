// Cue quality (Rey 2026-11-06, counting only): how well does a prey's speed tell sick from not sick, with no memory (one reading)?
// AUC = chance a random sick prey is slower than a random not-sick prey (0.5 = no information, 1 = perfect, below 0.5 = inverted).
//   node scripts/cue-quality.mjs [seed] [ticks]   (samples every 10 ticks after tick 3000; the world the night batch uses)
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const { SICK } = await import(`${R}/src/engine/toxin.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const seed = Number(process.argv[2] ?? 1), T = Number(process.argv[3] ?? 12000);
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1 };
const w = createWorld(seed, rules);
const pts = []; // [speed, toxin, nearHunter]
for (let t = 0; t < T; t += 10) {
  runTicks(w, 10);
  if (t < 3000) continue;
  for (const c of w.creatures) {
    if (!c.alive) continue;
    let near = false;
    for (const h of w.hunters) { const dx = c.x - h.x, dy = c.y - h.y; if (dx * dx + dy * dy < 2500) { near = true; break; } }
    pts.push([c.speed, c.toxin, near]);
  }
}
// AUC: chance that a random sick prey is slower than a random not-sick prey (0.5 = no information)
function auc(sub, thr) {
  const sick = sub.filter((p) => p[1] > thr).map((p) => p[0]), ok = sub.filter((p) => p[1] <= SICK).map((p) => p[0]);
  if (!sick.length || !ok.length) return [NaN, sick.length, ok.length];
  ok.sort((a, b) => a - b);
  let s = 0;
  for (const v of sick) { let lo = 0, hi = ok.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ok[m] < v) lo = m + 1; else hi = m; } let lo2 = lo, hi2 = ok.length; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (ok[m] <= v) lo2 = m + 1; else hi2 = m; } s += (ok.length - hi2) + 0.5 * (hi2 - lo); }
  return [s / (sick.length * ok.length), sick.length, ok.length];
}
const f = (a) => `${a[0].toFixed(2)} (sick ${a[1]}, ok ${a[2]})`;
const sp = (xs) => { const s = xs.map((p) => p[0]).sort((a, b) => a - b); return `speed p10 ${s[Math.floor(s.length * .1)].toFixed(2)} median ${s[s.length >> 1].toFixed(2)} p90 ${s[Math.floor(s.length * .9)].toFixed(2)}`; };
console.log(`seed ${seed}, ${T} ticks, samples ${pts.length}`);
console.log("all prey      AUC sick>0.1:", f(auc(pts, SICK)), "| sick>0.5:", f(auc(pts, 0.5)));
const nh = pts.filter((p) => p[2]);
console.log("prey near hunters (<50px) AUC sick>0.1:", f(auc(nh, SICK)), "| sick>0.5:", f(auc(nh, 0.5)));
console.log(sp(pts), "| not sick:", sp(pts.filter((p) => p[1] <= SICK)), "| sick>0.5:", pts.some((p) => p[1] > 0.5) ? sp(pts.filter((p) => p[1] > 0.5)) : "none");

// Prey event log (Rey 2026-11-09: "same rate of adaptability as prey?"; counting only): for every prey, meals, poison pellets, babies and
// death, so the cost of one mistake can be compared with the hunters' (scripts/hunter-log.mjs).   node scripts/prey-log.mjs [seed] [ticks] [--rule=value ...]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const [seed, T] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 15000)];
const extra = Object.fromEntries(process.argv.slice(4).map((a) => /^--(\w+)=(.+)$/.exec(a)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, ...extra };
const w = createWorld(seed, rules);
const st = new Map(); // prey -> { born, eaten, poisoned, kids, e, events: [[tick, isPoison]] }
const done = [];
for (let t = 0; t < T; t++) {
  runTicks(w, 1);
  const alive = new Set();
  for (const c of w.creatures) {
    if (!c.alive) continue;
    alive.add(c);
    let s = st.get(c);
    if (!s) { s = { born: w.tick, eaten: c.eaten, poisoned: c.poisoned, kids: 0, e: c.energy, events: [], caught: false }; st.set(c, s); }
    if (c.poisoned > s.poisoned) s.events.push([w.tick, 1]);
    if (c.eaten > s.eaten) s.events.push([w.tick, 0]);
    if (s.e >= 0.85 && c.energy < s.e * 0.65) s.kids++; // a split halves energy from about 1.2+; a starving prey losing its last energy is not a birth
    s.eaten = c.eaten; s.poisoned = c.poisoned; s.e = c.energy;
  }
  for (const [c, s] of st) if (!alive.has(c)) { s.died = w.tick; s.caught = c.caught > 0; if (s.born > 2000) done.push(s); st.delete(c); }
}
const med = (xs) => { if (!xs.length) return "n/a"; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "n/a");
const meals = (s) => s.events.filter((e) => !e[1]).length, pois = (s) => s.events.filter((e) => e[1]).length;
// after one event: died within 300 ticks?
const after = (isP) => { let n = 0, d = 0; for (const s of done) for (const [tk, p] of s.events) if (p === isP) { n++; if (s.died - tk <= 300) d++; } return [d, n]; };
const [dp, np] = after(1), [dc, nc] = after(0);
const bred = done.filter((s) => s.kids > 0), not = done.filter((s) => s.kids === 0);
const share = (xs) => { const m = xs.reduce((a, s) => a + meals(s), 0), p = xs.reduce((a, s) => a + pois(s), 0); return pct(p, m + p); };
console.log(`PREY seed ${seed}, ${T} ticks, ${JSON.stringify(extra)}: ${done.length} lives | lifespan median ${med(done.map((s) => s.died - s.born))} | caught by a hunter ${pct(done.filter((s) => s.caught).length, done.length)}`);
console.log(`meals per life median ${med(done.map(meals))} | poison pellets per life mean ${(done.reduce((a, s) => a + pois(s), 0) / done.length).toFixed(2)}; ate poison at least once ${pct(done.filter((s) => pois(s) > 0).length, done.length)} | poison share of everything eaten ${share(done)}`);
console.log(`cost of one mistake: died within 300 ticks after a poison pellet ${pct(dp, np)} (n ${np}) vs after a clean meal ${pct(dc, nc)} (n ${nc})`);
console.log(`who breeds: ${pct(bred.length, done.length)} | bred among those that ate poison ${pct(done.filter((s) => pois(s) > 0 && s.kids > 0).length, done.filter((s) => pois(s) > 0).length)} vs never ate poison ${pct(done.filter((s) => pois(s) === 0 && s.kids > 0).length, done.filter((s) => pois(s) === 0).length)} | poison share of intake: breeders ${share(bred)}, non-breeders ${share(not)}`);

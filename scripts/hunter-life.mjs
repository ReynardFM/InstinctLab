// Hunter life (Rey 2026-11-06 "find dose problem or other potential", counting only): births vs restarts per round, why hunters die,
// how long after a poisoned catch, and how much poison they carry at death.   node scripts/hunter-life.mjs [seed] [ticks] [--rule=value ...]
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const [seed, T] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 30000)];
const extra = Object.fromEntries(process.argv.slice(4).map((a) => /^--(\w+)=(.+)$/.exec(a)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, ...extra };
const w = createWorld(seed, rules);
const info = new Map(); // hunter -> { born, lastSick, sickCatches, catches }
let rounds = w.eco.rounds.length, births = 0, restartHunters = 0;
const deaths = { old: 0, starvedPoisoned: 0, starvedClean: 0 }, sinceSick = [], toxAtDeath = [], catchesAtDeath = [], birthsPerRound = [];
let roundBirths = 0;
let prev = new Set(w.hunters);
for (let t = 0; t < T; t++) {
  const tox = new Map(w.hunters.map((h) => [h, h.toxin])), caught = new Map(w.hunters.map((h) => [h, h.brain ? h.brain.caught : 0]));
  runTicks(w, 1);
  const now = new Set(w.hunters);
  const restarted = w.eco.rounds.length !== rounds;
  if (restarted) { rounds = w.eco.rounds.length; birthsPerRound.push(roundBirths); roundBirths = 0; restartHunters += w.hunters.length; }
  for (const h of prev) if (!now.has(h)) {
    const i = info.get(h) ?? { born: 0, lastSick: -1, sickCatches: 0, catches: 0 };
    if (h.age >= rules.hunterAge) deaths.old++; else if (h.toxin > 0.1) deaths.starvedPoisoned++; else deaths.starvedClean++;
    if (i.lastSick >= 0) sinceSick.push(w.tick - i.lastSick);
    toxAtDeath.push(h.toxin); catchesAtDeath.push(i.catches);
  }
  for (const h of now) {
    if (!prev.has(h)) { info.set(h, { born: w.tick, lastSick: -1, sickCatches: 0, catches: 0 }); if (!restarted) { births++; roundBirths++; } }
    const i = info.get(h);
    if (tox.has(h) && h.toxin > tox.get(h) + 1e-9) { i.lastSick = w.tick; i.sickCatches++; }
    if (h.brain && caught.has(h) && h.brain.caught > caught.get(h)) i.catches += h.brain.caught - caught.get(h);
  }
  prev = now;
}
const q = (xs, p) => { if (!xs.length) return "n/a"; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))].toFixed(1); };
const nd = deaths.old + deaths.starvedPoisoned + deaths.starvedClean;
console.log(`seed ${seed}, ${T} ticks, ${JSON.stringify(extra)}: rounds ${rounds} | hunter births ${births}, hunters put in by restarts ${restartHunters} | births per round median ${q(birthsPerRound, .5)}, max ${q(birthsPerRound, 1)}`);
console.log(`deaths ${nd}: old age ${deaths.old}, starved while poisoned ${deaths.starvedPoisoned}, starved clean ${deaths.starvedClean} | ticks from last poisoned catch to death: median ${q(sinceSick, .5)} (n ${sinceSick.length}) | poison at death median ${q(toxAtDeath, .5)}, p90 ${q(toxAtDeath, .9)} | catches in life median ${q(catchesAtDeath, .5)}`);

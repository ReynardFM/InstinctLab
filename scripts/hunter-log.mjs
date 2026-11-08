// Hunter event log (Rey 2026-11-07: "data analyst approach: when they eat, at what age, why each died, who and when"). Counting only:
// steps the world one tick at a time and logs every hunter as an individual. Writes proto/out/hunter-log/<name>/hunters.csv and
// catches.csv, then prints a short analysis.   node scripts/hunter-log.mjs <name> [seed] [ticks] [--rule=value ...]
import { mkdirSync, writeFileSync } from "node:fs";
const R = process.cwd();
const { createWorld, runTicks, DEFAULT_RULES } = await import(`${R}/src/engine/world.ts`);
const { ECO_BASE } = await import(`${R}/src/cli/eco-lab.ts`);
const base = Object.fromEntries(Object.entries(ECO_BASE).map(([k, v]) => [k, v[0]]));
const [name, seed, T] = [process.argv[2] ?? "run", Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 30000)];
const extra = Object.fromEntries(process.argv.slice(5).map((a) => /^--(\w+)=(.+)$/.exec(a)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
const rules = { ...DEFAULT_RULES, ...base, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, ...extra };
const w = createWorld(seed, rules);
const id = new WeakMap(), rec = new Map(); let next = 1;
const H = [], C = [];
let round = 0, rounds = w.eco.rounds.length;
const add = (h, origin, parent) => {
  const i = next++; id.set(h, i);
  const r = { id: i, origin, parent, round, born: w.tick, bornEnergy: +h.energy.toFixed(3), died: "", ageAtDeath: "", cause: "alive", energyAtDeath: "", toxinAtDeath: "",
    catches: 0, sickCatches: 0, firstCatchAge: "", lastCatchTick: "", lastSickTick: "", babies: 0, maxToxin: 0 };
  rec.set(i, r); H.push(r); return r;
};
for (const h of w.hunters) add(h, "start", "");
let prev = w.hunters.map((h) => ({ h, e: h.energy, t: h.toxin, c: h.brain ? h.brain.caught : 0, age: h.age, x: h.x, y: h.y }));
for (let t = 0; t < T; t++) {
  runTicks(w, 1);
  const restarted = w.eco.rounds.length !== rounds;
  if (restarted) { rounds = w.eco.rounds.length; round++; }
  const now = new Set(w.hunters);
  for (const p of prev) {
    const r = rec.get(id.get(p.h));
    if (now.has(p.h)) {
      const h = p.h, dc = (h.brain ? h.brain.caught : 0) - p.c;
      if (dc > 0) {
        const dose = Math.max(0, h.toxin - p.t * (1 - Math.LN2 / rules.poisonHalfLife));
        const sick = dose > 0.01;
        r.catches += dc; if (sick) { r.sickCatches++; r.lastSickTick = w.tick; }
        if (r.firstCatchAge === "") r.firstCatchAge = h.age;
        r.lastCatchTick = w.tick;
        C.push({ tick: w.tick, hunter: r.id, age: h.age, round, sick: sick ? 1 : 0, dose: +dose.toFixed(3), energyBefore: +p.e.toFixed(3), energyAfter: +h.energy.toFixed(3), toxinAfter: +h.toxin.toFixed(3) });
      }
      r.maxToxin = Math.max(r.maxToxin, +h.toxin.toFixed(3));
    } else {
      r.died = w.tick; r.ageAtDeath = p.age + 1;
      r.cause = p.age + 1 >= rules.hunterAge ? "old" : p.e <= rules.hunterHunger * (1 + p.t) * 1.01 || p.e <= 0.02 ? (p.t > 0.1 ? "starved_poisoned" : "starved_clean") : "culled";
      r.energyAtDeath = +p.e.toFixed(3); r.toxinAtDeath = +p.t.toFixed(3);
    }
  }
  const prevSet = new Set(prev.map((p) => p.h));
  for (const h of w.hunters) if (!prevSet.has(h)) {
    if (restarted) { add(h, "restart", ""); continue; }
    let par = null, best = 0;
    for (const p of prev) if (now.has(p.h) && p.e - p.h.energy > best && Math.hypot(p.h.x - h.x, p.h.y - h.y) < 12) { best = p.e - p.h.energy; par = p.h; }
    const pr = par ? rec.get(id.get(par)) : null; if (pr) pr.babies++;
    add(h, "birth", pr ? pr.id : "");
  }
  prev = w.hunters.map((h) => ({ h, e: h.energy, t: h.toxin, c: h.brain ? h.brain.caught : 0, age: h.age, x: h.x, y: h.y }));
}
const dir = `proto/out/hunter-log/${name}`; mkdirSync(dir, { recursive: true });
const csv = (rows) => [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).join(","))].join("\n");
writeFileSync(`${dir}/hunters.csv`, csv(H)); if (C.length) writeFileSync(`${dir}/catches.csv`, csv(C));
// ---- analysis
const dead = H.filter((r) => r.cause !== "alive"), med = (xs) => { if (!xs.length) return "n/a"; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "n/a");
console.log(`${name}: seed ${seed}, ${T} ticks, ${JSON.stringify(extra)} | hunters logged ${H.length} (start ${H.filter((r) => r.origin === "start").length}, restart ${H.filter((r) => r.origin === "restart").length}, birth ${H.filter((r) => r.origin === "birth").length}) | die-out rounds ${round} | catches ${C.length} (sick ${C.filter((c) => c.sick).length})`);
const causes = ["starved_clean", "starved_poisoned", "culled", "old"];
console.log(`deaths ${dead.length}: ${causes.map((c) => `${c} ${pct(dead.filter((r) => r.cause === c).length, dead.length)}`).join(", ")}`);
console.log(`age at death (median): ${causes.map((c) => `${c} ${med(dead.filter((r) => r.cause === c).map((r) => r.ageAtDeath))}`).join(", ")} | maturity is ${rules.hunterMature}: died before it ${pct(dead.filter((r) => r.ageAtDeath < rules.hunterMature).length, dead.length)}`);
console.log(`catches in life (median): all ${med(dead.map((r) => r.catches))}; never caught anything ${pct(dead.filter((r) => r.catches === 0).length, dead.length)} | first catch at age (median) ${med(H.filter((r) => r.firstCatchAge !== "").map((r) => r.firstCatchAge))}`);
const sp = dead.filter((r) => r.cause === "starved_poisoned");
console.log(`starved poisoned: ticks from last sick catch to death (median) ${med(sp.filter((r) => r.lastSickTick !== "").map((r) => r.died - r.lastSickTick))}; poison at death (median) ${med(sp.map((r) => r.toxinAtDeath))}; had a sick catch at all ${pct(sp.filter((r) => r.sickCatches > 0).length, sp.length)}`);
const sc = dead.filter((r) => r.cause === "starved_clean");
console.log(`starved clean: ticks from last catch to death (median) ${med(sc.filter((r) => r.lastCatchTick !== "").map((r) => r.died - r.lastCatchTick))}; never caught ${pct(sc.filter((r) => r.catches === 0).length, sc.length)}; born with energy (median) ${med(sc.map((r) => r.bornEnergy))}`);
const parents = H.filter((r) => r.babies > 0);
console.log(`who breeds: ${parents.length} of ${H.length} hunters had babies (${pct(parents.length, H.length)}); babies per parent (median) ${med(parents.map((r) => r.babies))}; parents' catches (median) ${med(parents.map((r) => r.catches))}, sick catches (median) ${med(parents.map((r) => r.sickCatches))}`);
const bands = [[0, 500], [500, 1000], [1000, 2000], [2000, 6001]];
console.log(`catches by hunter age: ${bands.map(([a, b]) => `${a}-${b} ${C.filter((c) => c.age >= a && c.age < b).length} (sick ${pct(C.filter((c) => c.age >= a && c.age < b && c.sick).length, C.filter((c) => c.age >= a && c.age < b).length)})`).join(", ")}`);
const avgOf = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN);
console.log(`populations: prey ${avgOf(w.eco.popHist).toFixed(1)} avg (min ${Math.min(...w.eco.popHist)}), hunters ${avgOf(w.eco.hunterPopHist).toFixed(1)} avg (max ${Math.max(...w.eco.hunterPopHist)}) | prey restarts ${w.eco.rescues} | rounds ended by: ${["prey", "hunters", "both"].map((d) => d + " " + w.eco.rounds.filter((r) => r.died === d).length).join(", ")}`);
console.log(`files: ${dir}/hunters.csv, ${dir}/catches.csv`);

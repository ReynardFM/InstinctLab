"use strict";
(() => {
  // test/golden.json
  var golden_default = { "7": { avg: [1.225, 4.475, 5.275, 11.275, 16, 21.2, 24.825, 27.275, 27.725, 26.575], best: [8, 25, 17, 44, 46, 49, 58, 49, 61, 51] }, "42": { avg: [2.025, 8.525, 15.1, 15.65, 22.5, 23.3, 26.075, 25.75, 29.45, 32.7], best: [32, 43, 42, 38, 69, 54, 61, 71, 58, 61] }, hello: { avg: [2.325, 5.25, 4.375, 10.4, 12.45, 15.95, 21.225, 28, 32.1, 30], best: [11, 15, 21, 32, 50, 50, 57, 55, 59, 53] }, custom: { avg: [0.13333333333333333, 0.06666666666666667, 0.06666666666666667, 0.5333333333333333, 0.13333333333333333, 0.06666666666666667, 1.2666666666666666, 1.3333333333333333, 1.2666666666666666, 2.1333333333333333], best: [1, 1, 1, 5, 1, 1, 9, 10, 9, 11] }, defaults: { avg: [2.3000000000000003, 7.716666666666666, 12.641666666666666], best: [19, 26.333333333333332, 48] } };

  // src/engine/rng.ts
  function createRng(seed) {
    let a = seed;
    const next = () => {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const gauss = () => {
      const u = next() || 1e-9;
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return { next, gauss };
  }
  function seedFrom(text) {
    const n = Number(text);
    return Number.isFinite(n) ? n : [...text].reduce((h, c) => h * 31 + c.charCodeAt(0) | 0, 7);
  }

  // src/engine/brain.ts
  var IN = 4;
  var HID = 6;
  var OUT = 2;
  var genomeSize = (inputs) => inputs * HID + HID + HID * OUT + OUT;
  var GENOME = genomeSize(IN);
  function think(g, inputs) {
    let k = 0;
    const hidden = [];
    const out = [];
    const n = inputs.length;
    for (let h = 0; h < HID; h++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += inputs[i] * g[k++];
      hidden.push(Math.tanh(s + g[k++]));
    }
    for (let o = 0; o < OUT; o++) {
      let s = 0;
      for (let h = 0; h < HID; h++) s += hidden[h] * g[k++];
      out.push(Math.tanh(s + g[k++]));
    }
    return { hidden, out };
  }

  // src/engine/space.ts
  var W = 800;
  var H = 600;
  function nearest(items, x, y, walls, count, skip) {
    const found = [];
    const fdx = [];
    const fdy = [];
    const fd2 = [];
    const halfW = W / 2;
    const halfH = H / 2;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      if (skip !== void 0 && skip(item)) continue;
      let dx = item.x - x;
      let dy = item.y - y;
      if (!walls) {
        if (dx > halfW) dx -= W;
        else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H;
        else if (dy < -halfH) dy += H;
      }
      const d2 = dx * dx + dy * dy;
      let i = found.length;
      if (i === count && d2 >= fd2[count - 1]) continue;
      if (i === count) i--;
      while (i > 0 && d2 < fd2[i - 1]) {
        found[i] = found[i - 1];
        fdx[i] = fdx[i - 1];
        fdy[i] = fdy[i - 1];
        fd2[i] = fd2[i - 1];
        i--;
      }
      found[i] = item;
      fdx[i] = dx;
      fdy[i] = dy;
      fd2[i] = d2;
    }
    return found.map((item, i) => ({ item, dx: fdx[i], dy: fdy[i], d2: fd2[i] }));
  }

  // src/engine/senses.ts
  function inputCount(r) {
    return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.walls ? 1 : 0);
  }
  function towards(dx, dy, d2, heading) {
    const rel = Math.atan2(dy, dx) - heading;
    return [Math.sin(rel), Math.cos(rel), Math.min(Math.sqrt(d2) / 200, 1)];
  }
  var NOTHING = [0, 0, 1];
  function wallAhead(x, y, heading) {
    const cx = Math.cos(heading);
    const cy = Math.sin(heading);
    const tx = cx > 0 ? (W - x) / cx : cx < 0 ? -x / cx : Infinity;
    const ty = cy > 0 ? (H - y) / cy : cy < 0 ? -y / cy : Infinity;
    return Math.min(Math.min(tx, ty) / 200, 1);
  }
  function sense(w, c) {
    const r = w.rules;
    const walls = r.walls > 0;
    const foods = nearest(w.food, c.x, c.y, walls, r.senseFood2 ? 2 : 1);
    const f = foods[0];
    const first = f ? towards(f.dx, f.dy, f.d2, c.a) : towards(0, 0, Infinity, c.a);
    const inputs = [...first, c.energy];
    if (r.senseFood2) {
      const s = foods[1];
      inputs.push(...s ? towards(s.dx, s.dy, s.d2, c.a) : NOTHING);
    }
    if (r.senseCreature) {
      const n = nearest(w.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
      inputs.push(...n ? towards(n.dx, n.dy, n.d2, c.a) : NOTHING);
    }
    if (walls) inputs.push(wallAhead(c.x, c.y, c.a));
    return { inputs, food: f ? f.item : null, foodDist: f ? Math.sqrt(f.d2) : Infinity };
  }

  // src/engine/creature.ts
  function newFood(w) {
    return { x: w.rng.next() * W, y: w.rng.next() * H };
  }
  function newCreature(w, genome, family, elite, parentHue) {
    const { rng } = w;
    const id = w.nextId++;
    const hue = parentHue === null ? founderHue(family) : elite ? parentHue : (parentHue + hueDrift(id) + 360) % 360;
    return {
      id,
      family,
      hue,
      elite,
      branch: null,
      streak: 0,
      g: genome,
      x: rng.next() * W,
      y: rng.next() * H,
      a: rng.next() * Math.PI * 2,
      energy: 1,
      eaten: 0,
      alive: true,
      diedAt: null,
      inputs: new Array(inputCount(w.rules)).fill(0),
      hidden: new Array(HID).fill(0),
      out: [0, 0]
    };
  }
  function founderHue(family) {
    return family * 137.508 % 360;
  }
  function hueDrift(id) {
    let h = Math.imul(id ^ 2654435769, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 * 16 - 8;
  }

  // src/engine/lineage.ts
  var LEGACY_LIMIT = 500;
  function settleLineage(w, proven) {
    for (const b of proven) promote(w, b);
    const inBranch = new Set(w.creatures.map((c) => c.branch));
    for (const id of [...w.branches.keys()]) {
      if (!inBranch.has(id)) {
        w.branches.delete(id);
        w.failedBranches++;
      }
    }
    const alive = new Set(w.creatures.map((c) => c.family));
    for (const fam of [...w.families.values()]) if (!alive.has(fam.id)) retire(w, fam, w.generation);
  }
  function maybeSplit(w, child) {
    const limit = w.rules.splitDistance;
    if (child.branch !== null) return;
    const fam = w.families.get(child.family);
    if (!limit || !fam || brainDistance(child.g, fam.ref) <= limit) return;
    for (const f of w.families.values()) {
      if (f.parent === child.family && brainDistance(child.g, f.ref) <= limit) {
        child.family = f.id;
        child.hue = founderHue(f.id);
        return;
      }
    }
    if (w.rules.splitProof > 0) {
      for (const b of w.branches.values()) {
        if (b.family === child.family && brainDistance(child.g, b.ref) <= limit) {
          child.branch = b.id;
          return;
        }
      }
      const id2 = w.nextBranchId++;
      w.branches.set(id2, { id: id2, family: child.family, ref: child.g.slice(), bornGeneration: w.generation + 1, wins: 0 });
      child.branch = id2;
      return;
    }
    const id = w.nextFamilyId++;
    w.families.set(id, newFamily(id, child.g, child.family, w.generation + 1));
    child.family = id;
    child.hue = founderHue(id);
    w.splits++;
  }
  function judgeBranches(w, ranked) {
    const proven = [];
    for (const b of w.branches.values()) {
      let inSum = 0, inN = 0, outSum = 0, outN = 0;
      for (const c of ranked) {
        if (c.branch === b.id) {
          inSum += c.eaten;
          inN++;
        } else if (c.family === b.family) {
          outSum += c.eaten;
          outN++;
        }
      }
      if (inN === 0) continue;
      const won = outN === 0 || inSum / inN > outSum / outN;
      b.wins = won ? b.wins + 1 : 0;
      if (b.wins >= w.rules.splitProof) proven.push(b);
    }
    return proven;
  }
  function promote(w, b) {
    w.branches.delete(b.id);
    const id = w.nextFamilyId++;
    w.families.set(id, newFamily(id, b.ref, b.family, w.generation + 1));
    w.splits++;
    for (const c of w.creatures) {
      if (c.branch === b.id) {
        c.branch = null;
        c.family = id;
        c.hue = founderHue(id);
      }
    }
  }
  function newFamily(id, genome, parent, bornGeneration) {
    return {
      id,
      ref: genome.slice(),
      founderRef: genome.slice(),
      champions: [],
      parent,
      bornGeneration,
      diedGeneration: null,
      peakSize: 0,
      bestEaten: 0,
      avgHist: [],
      newcomer: false,
      protectedUntil: 0
    };
  }
  function addNewcomer(w, ranked, next, parents) {
    const { rules, rng } = w;
    const p = ranked[Math.floor(rng.next() * parents)];
    const genome = p.g.map((x) => x + rng.gauss() * rules.newcomerMutation);
    const id = w.nextFamilyId++;
    const born = w.generation + 1;
    const fam = newFamily(id, genome, p.family, born);
    fam.newcomer = true;
    fam.protectedUntil = born + rules.protectGens;
    w.families.set(id, fam);
    w.newcomerCount++;
    next.push(newCreature(w, genome, id, false, null));
  }
  function protectNewcomers(w, ranked, next, elite) {
    const { rules, rng } = w;
    for (const fam of w.families.values()) {
      if (!fam.newcomer || w.generation >= fam.protectedUntil) continue;
      const i = ranked.findIndex((c) => c.family === fam.id);
      if (i < 0) continue;
      const best = ranked[i];
      if (i >= elite && next.length < rules.pop) {
        const keep = newCreature(w, best.g.slice(), fam.id, true, best.hue);
        keep.elite = false;
        keep.branch = best.branch;
        next.push(keep);
      }
      if (next.length < rules.pop) {
        const child = newCreature(w, best.g.map((x) => x + rng.gauss() * rules.mutation), fam.id, false, best.hue);
        child.branch = best.branch;
        maybeSplit(w, child);
        next.push(child);
      }
    }
  }
  function recordFamilyStats(w, ranked, per) {
    const sizes = /* @__PURE__ */ new Map();
    const sums = /* @__PURE__ */ new Map();
    for (const c of ranked) {
      sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
      sums.set(c.family, (sums.get(c.family) ?? 0) + c.eaten);
      const fam = w.families.get(c.family);
      if (fam && c.eaten / per > fam.bestEaten) fam.bestEaten = c.eaten / per;
    }
    for (const [id, n] of sizes) {
      const fam = w.families.get(id);
      if (!fam) continue;
      if (n > fam.peakSize) fam.peakSize = n;
      fam.avgHist.push(sums.get(id) / n / per);
    }
  }
  function crownChampions(w, elites) {
    if (!w.rules.championStreak) return;
    const seen = /* @__PURE__ */ new Set();
    for (const c of elites) {
      if (c.branch !== null || seen.has(c.family)) continue;
      seen.add(c.family);
      const fam = w.families.get(c.family);
      if (fam && c.streak === w.rules.championStreak) {
        fam.ref = c.g.slice();
        fam.champions.push({ generation: w.generation + 1, genome: c.g.slice() });
      }
    }
  }
  function retire(w, fam, lastGeneration) {
    fam.diedGeneration = lastGeneration;
    w.families.delete(fam.id);
    w.legacy.push(fam);
    if (w.legacy.length > LEGACY_LIMIT) w.legacy.splice(0, w.legacy.length - LEGACY_LIMIT);
  }
  function brainDistance(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s / a.length);
  }

  // src/engine/world.ts
  var DEFAULT_RULES = {
    pop: 40,
    food: 60,
    genTicks: 1500,
    elite: 2,
    parents: 8,
    mutation: 0.15,
    splitDistance: 0.6,
    championStreak: 3,
    layouts: 3,
    splitProof: 3,
    senseFood2: 0,
    senseCreature: 1,
    walls: 0,
    newcomers: 1,
    newcomerMutation: 0.4,
    protectGens: 3
  };
  function createWorld(seed, rules) {
    const w = {
      rules: { ...rules },
      rng: createRng(seed),
      creatures: [],
      food: [],
      tick: 0,
      generation: 1,
      layout: 0,
      avgHist: [],
      bestHist: [],
      worstHist: [],
      topHalfHist: [],
      nextId: 0,
      families: /* @__PURE__ */ new Map(),
      legacy: [],
      nextFamilyId: rules.pop,
      splits: 0,
      branches: /* @__PURE__ */ new Map(),
      nextBranchId: 0,
      failedBranches: 0,
      newcomerCount: 0
    };
    for (let i = 0; i < rules.pop; i++) {
      const genome = Array.from({ length: genomeSize(inputCount(rules)) }, () => w.rng.gauss() * 0.5);
      w.creatures.push(newCreature(w, genome, i, false, null));
      w.families.set(i, newFamily(i, genome, null, 1));
    }
    w.food = Array.from({ length: rules.food }, () => newFood(w));
    return w;
  }
  function step(w) {
    const walls = w.rules.walls > 0;
    for (const c of w.creatures) {
      if (!c.alive) continue;
      const seen = sense(w, c);
      c.inputs = seen.inputs;
      const { hidden, out } = think(c.g, c.inputs);
      c.hidden = hidden;
      c.out = out;
      const speed = (out[1] + 1) / 2 * 3;
      c.a += out[0] * 0.2;
      if (walls) {
        c.x = Math.min(Math.max(c.x + Math.cos(c.a) * speed, 0), W);
        c.y = Math.min(Math.max(c.y + Math.sin(c.a) * speed, 0), H);
      } else {
        c.x = (c.x + Math.cos(c.a) * speed + W) % W;
        c.y = (c.y + Math.sin(c.a) * speed + H) % H;
      }
      c.energy -= 5e-4 + speed * 4e-4;
      if (seen.food && seen.foodDist < 6) {
        c.eaten++;
        c.energy = Math.min(c.energy + 0.3, 1.5);
        Object.assign(seen.food, newFood(w));
      }
      if (c.energy <= 0) {
        c.alive = false;
        c.diedAt = w.tick;
      }
    }
    w.tick++;
    if (w.tick >= w.rules.genTicks || w.creatures.every((c) => !c.alive)) {
      if (w.layout + 1 < w.rules.layouts) nextLayout(w);
      else nextGeneration(w);
    }
  }
  function nextLayout(w) {
    w.layout++;
    for (const c of w.creatures) {
      c.x = w.rng.next() * W;
      c.y = w.rng.next() * H;
      c.a = w.rng.next() * Math.PI * 2;
      c.energy = 1;
      c.alive = true;
      c.diedAt = null;
    }
    w.food = Array.from({ length: w.rules.food }, () => newFood(w));
    w.tick = 0;
  }
  function runGenerations(w, generations) {
    const target = w.generation + generations;
    while (w.generation < target) step(w);
  }
  function nextGeneration(w) {
    const { rules, rng } = w;
    const ranked = [...w.creatures].sort((a, b) => b.eaten - a.eaten);
    const per = Math.max(1, rules.layouts);
    w.avgHist.push(ranked.reduce((s, c) => s + c.eaten, 0) / ranked.length / per);
    w.bestHist.push(ranked[0].eaten / per);
    w.worstHist.push(ranked[ranked.length - 1].eaten / per);
    const half = ranked.slice(0, Math.ceil(ranked.length / 2));
    w.topHalfHist.push(half.reduce((s, c) => s + c.eaten, 0) / half.length / per);
    const elite = Math.min(rules.elite, rules.pop);
    const parents = Math.max(1, Math.min(rules.parents, rules.pop));
    const next = [];
    recordFamilyStats(w, ranked, per);
    const proven = judgeBranches(w, ranked);
    for (let i = 0; i < elite; i++) {
      const copy = newCreature(w, ranked[i].g.slice(), ranked[i].family, true, ranked[i].hue);
      copy.streak = ranked[i].streak + 1;
      copy.branch = ranked[i].branch;
      next.push(copy);
    }
    crownChampions(w, next);
    protectNewcomers(w, ranked, next, elite);
    for (let i = 0; i < rules.newcomers && next.length < rules.pop; i++) addNewcomer(w, ranked, next, parents);
    while (next.length < rules.pop) {
      const p = ranked[Math.floor(rng.next() * parents)];
      const child = newCreature(w, p.g.map((x) => x + rng.gauss() * rules.mutation), p.family, false, p.hue);
      child.branch = p.branch;
      maybeSplit(w, child);
      next.push(child);
    }
    w.creatures = next;
    settleLineage(w, proven);
    w.food = Array.from({ length: rules.food }, () => newFood(w));
    w.tick = 0;
    w.layout = 0;
    w.generation++;
  }

  // src/check/golden.ts
  var BASE_RULES = {
    ...DEFAULT_RULES,
    layouts: 1,
    senseFood2: 0,
    senseCreature: 0,
    walls: 0,
    newcomers: 0
  };
  var CASES = [
    ...["42", "7", "hello"].map((t) => ({ name: t, seed: seedFrom(t), rules: BASE_RULES, gens: 10, checkBest: true })),
    {
      name: "custom",
      seed: 42,
      gens: 10,
      checkBest: false,
      rules: { ...BASE_RULES, pop: 15, food: 20, elite: 0, parents: 50, mutation: 0.4, genTicks: 400 }
    },
    { name: "defaults", seed: seedFrom("42"), rules: DEFAULT_RULES, gens: 3, checkBest: true }
  ];
  function runCase(c) {
    const w = createWorld(c.seed, c.rules);
    runGenerations(w, c.gens);
    return c.checkBest ? { avg: w.avgHist, best: w.bestHist } : { avg: w.avgHist };
  }
  function firstDifference(got, want) {
    for (const key of ["avg", "best"]) {
      const g = got[key];
      const e = want[key];
      if (!g || !e) continue;
      if (g.length !== e.length) return `${key}: ${g.length} generations, expected ${e.length}`;
      for (let i = 0; i < g.length; i++) {
        if (g[i] !== e[i]) return `${key}, generation ${i + 1}: got ${g[i]}, expected ${e[i]}`;
      }
    }
    return null;
  }

  // src/web/determinism.ts
  var golden = golden_default;
  var $ = (id) => document.getElementById(id);
  async function main() {
    $("agent").textContent = navigator.userAgent;
    const list = $("results");
    let bad = 0;
    for (const c of CASES) {
      const li = document.createElement("li");
      li.textContent = `${c.name}: running ${c.gens} generations...`;
      list.append(li);
      await new Promise((r) => setTimeout(r, 30));
      const want = golden[c.name];
      if (!want) {
        li.textContent = `${c.name}: not recorded yet`;
        continue;
      }
      const t0 = performance.now();
      const diff = firstDifference(runCase(c), want);
      const secs = ((performance.now() - t0) / 1e3).toFixed(1);
      li.className = diff ? "bad" : "good";
      li.textContent = diff ? `${c.name}: DIFFERENT. ${diff}` : `${c.name}: identical (${secs} s)`;
      if (diff) bad++;
    }
    $("summary").textContent = bad ? `${bad} recorded run(s) differ in this browser. Same seed does NOT give the same run here.` : "Every recorded run matches exactly in this browser.";
    $("summary").className = bad ? "bad" : "good";
  }
  void main();
})();

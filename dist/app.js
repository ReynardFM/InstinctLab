"use strict";
(() => {
  // src/engine/dmath.ts
  var HALF_PI_HI = 1.5707963267341256;
  var HALF_PI_LO = 6077100506506192e-26;
  var TWO_OVER_PI = 0.6366197723675814;
  var LN2_HI = 0.6931471803691238;
  var LN2_LO = 19082149292705877e-26;
  var INV_LN2 = 1.4426950408889634;
  var SQRT_HALF = 0.7071067811865476;
  var SQRT2 = 1.4142135623730951;
  var F = [1];
  for (let n = 1; n <= 20; n++) F.push(F[n - 1] / n);
  var P2 = new Array(129);
  P2[64] = 1;
  for (let i = 1; i <= 64; i++) {
    P2[64 + i] = P2[63 + i] * 2;
    P2[64 - i] = P2[65 - i] / 2;
  }
  function sinSmall(r) {
    const r2 = r * r;
    return r * (F[0] - r2 * (F[3] - r2 * (F[5] - r2 * (F[7] - r2 * (F[9] - r2 * (F[11] - r2 * (F[13] - r2 * (F[15] - r2 * (F[17] - r2 * F[19])))))))));
  }
  function cosSmall(r) {
    const r2 = r * r;
    return F[0] - r2 * (F[2] - r2 * (F[4] - r2 * (F[6] - r2 * (F[8] - r2 * (F[10] - r2 * (F[12] - r2 * (F[14] - r2 * (F[16] - r2 * F[18]))))))));
  }
  function sin(x) {
    const k = Math.floor(x * TWO_OVER_PI + 0.5);
    const r = x - k * HALF_PI_HI - k * HALF_PI_LO;
    const q = (k % 4 + 4) % 4;
    return q === 0 ? sinSmall(r) : q === 1 ? cosSmall(r) : q === 2 ? -sinSmall(r) : -cosSmall(r);
  }
  function cos(x) {
    const k = Math.floor(x * TWO_OVER_PI + 0.5);
    const r = x - k * HALF_PI_HI - k * HALF_PI_LO;
    const q = (k % 4 + 4) % 4;
    return q === 0 ? cosSmall(r) : q === 1 ? -sinSmall(r) : q === 2 ? -cosSmall(r) : sinSmall(r);
  }
  function expSmall(x) {
    const k = Math.floor(x * INV_LN2 + 0.5);
    const r = x - k * LN2_HI - k * LN2_LO;
    let p = F[17];
    for (let n = 16; n >= 0; n--) p = p * r + F[n];
    return p * P2[64 + k];
  }
  function tanh(x) {
    if (x !== x) return NaN;
    const a = x < 0 ? -x : x;
    let t;
    if (a >= 20) t = 1;
    else if (a < 0.05) {
      const a2 = a * a;
      t = a * (1 - a2 * (1 / 3 - a2 * (2 / 15 - a2 * (17 / 315 - a2 * (62 / 2835 - a2 * (1382 / 155925))))));
    } else {
      const e = expSmall(-2 * a);
      t = (1 - e) / (1 + e);
    }
    return x < 0 ? -t : t;
  }
  function log(x) {
    if (!(x > 0)) return x === 0 ? -Infinity : NaN;
    if (x === Infinity) return Infinity;
    let m = x;
    let e = 0;
    while (m < SQRT_HALF) {
      m *= 2;
      e--;
    }
    while (m >= SQRT2) {
      m /= 2;
      e++;
    }
    const s = (m - 1) / (m + 1);
    const s2 = s * s;
    let p = 1 / 23;
    for (let n = 21; n >= 1; n -= 2) p = p * s2 + 1 / n;
    return e * LN2_HI + (e * LN2_LO + 2 * s * p);
  }

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
      return Math.sqrt(-2 * log(u)) * cos(2 * Math.PI * v);
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
  var genomeSize = (inputs, hidden = HID) => inputs * hidden + hidden + hidden * OUT + OUT;
  var GENOME = genomeSize(IN);
  function think(g, inputs) {
    let k = 0;
    const hidden = [];
    const out = [];
    const n = inputs.length;
    const nh = (g.length - OUT) / (n + 1 + OUT);
    for (let h = 0; h < nh; h++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += inputs[i] * g[k++];
      hidden.push(tanh(s + g[k++]));
    }
    for (let o = 0; o < OUT; o++) {
      let s = 0;
      for (let h = 0; h < nh; h++) s += hidden[h] * g[k++];
      out.push(tanh(s + g[k++]));
    }
    return { hidden, out };
  }

  // src/engine/breed.ts
  function mutate(w, g, size) {
    const { rng } = w;
    const rate = w.rules.mutationRate;
    if (rate >= 1) return g.map((x) => x + rng.gauss() * size);
    return g.map((x) => rng.next() < rate ? x + rng.gauss() * size : x);
  }
  function centre(ranked, parents) {
    const fam = ranked[0].family;
    const chosen = ranked.slice(0, parents).filter((c) => c.family === fam);
    const n = chosen.length;
    const weights = chosen.map((_, i) => log(n + 0.5) - log(i + 1));
    const total = weights.reduce((s, x) => s + x, 0);
    const out = new Array(chosen[0].g.length).fill(0);
    for (let i = 0; i < n; i++) {
      const wt = weights[i] / total;
      const g = chosen[i].g;
      for (let k = 0; k < out.length; k++) out[k] += wt * g[k];
    }
    return out;
  }

  // src/engine/space.ts
  var W = 800;
  var H = 600;
  function wrapDelta(d, size) {
    if (d > size / 2) return d - size;
    if (d < -size / 2) return d + size;
    return d;
  }
  function offset(d, size, walls) {
    return walls ? d : wrapDelta(d, size);
  }
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
    return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.poison > 0 ? 3 : 0) + (r.walls ? 1 : 0);
  }
  function inputLabels(r) {
    const labels = ["Food left/right", "Food ahead", "Food distance", "Energy"];
    if (r.senseFood2) labels.push("2nd food left/right", "2nd food ahead", "2nd food distance");
    if (r.senseCreature) labels.push("Neighbour left/right", "Neighbour ahead", "Neighbour distance");
    if (r.poison > 0) labels.push("Poison left/right", "Poison ahead", "Poison distance");
    if (r.walls) labels.push("Wall distance ahead");
    return labels;
  }
  function towards(dx, dy, d2, cosH, sinH) {
    const d = Math.sqrt(d2);
    const ok = d > 0 && d !== Infinity;
    const st = ok ? dy / d : 0;
    const ct = ok ? dx / d : 1;
    return [st * cosH - ct * sinH, ct * cosH + st * sinH, Math.min(d / 200, 1)];
  }
  var NOTHING = [0, 0, 1];
  function wallAhead(x, y, heading) {
    const cx = cos(heading);
    const cy = sin(heading);
    const tx = cx > 0 ? (W - x) / cx : cx < 0 ? -x / cx : Infinity;
    const ty = cy > 0 ? (H - y) / cy : cy < 0 ? -y / cy : Infinity;
    return Math.min(Math.min(tx, ty) / 200, 1);
  }
  function scanFood(w, x, y, goodCount) {
    const walls = w.rules.walls > 0;
    const tick = w.tick;
    const halfW = W / 2;
    const halfH = H / 2;
    const good = [];
    let poison;
    for (const f of w.food) {
      if (f.readyAt > tick) continue;
      let dx = f.x - x;
      let dy = f.y - y;
      if (!walls) {
        if (dx > halfW) dx -= W;
        else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H;
        else if (dy < -halfH) dy += H;
      }
      const d2 = dx * dx + dy * dy;
      if (f.poison) {
        if (poison === void 0 || d2 < poison.d2) poison = { item: f, dx, dy, d2 };
        continue;
      }
      if (good.length === goodCount && d2 >= good[goodCount - 1].d2) continue;
      let i = good.length === goodCount ? goodCount - 1 : good.length;
      while (i > 0 && d2 < good[i - 1].d2) {
        good[i] = good[i - 1];
        i--;
      }
      good[i] = { item: f, dx, dy, d2 };
    }
    return { good, poison };
  }
  function sense(w, c) {
    const r = w.rules;
    const walls = r.walls > 0;
    const scan = scanFood(w, c.x, c.y, r.senseFood2 ? 2 : 1);
    const foods = scan.good;
    const f = foods[0];
    const p = scan.poison;
    const cosH = cos(c.a);
    const sinH = sin(c.a);
    const first = f ? towards(f.dx, f.dy, f.d2, cosH, sinH) : towards(0, 0, Infinity, cosH, sinH);
    const inputs = [...first, c.energy];
    if (r.senseFood2) {
      const s = foods[1];
      inputs.push(...s ? towards(s.dx, s.dy, s.d2, cosH, sinH) : NOTHING);
    }
    if (r.senseCreature) {
      const n = nearest(w.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
      inputs.push(...n ? towards(n.dx, n.dy, n.d2, cosH, sinH) : NOTHING);
    }
    if (r.poison > 0) inputs.push(...p ? towards(p.dx, p.dy, p.d2, cosH, sinH) : NOTHING);
    if (walls) inputs.push(wallAhead(c.x, c.y, c.a));
    const eat = p && (!f || p.d2 < f.d2) ? p : f;
    return { inputs, food: eat ? eat.item : null, foodDist: eat ? Math.sqrt(eat.d2) : Infinity };
  }

  // src/engine/creature.ts
  function newFood(w, poison = false) {
    return { x: w.env.next() * W, y: w.env.next() * H, poison, readyAt: 0 };
  }
  function newFoodLayout(w) {
    const poisonCount = Math.round(w.rules.poison * w.rules.food);
    return Array.from({ length: w.rules.food }, (_, i) => newFood(w, i < poisonCount));
  }
  function newCreature(w, genome, family, elite, parentHue) {
    const { env } = w;
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
      x: env.next() * W,
      y: env.next() * H,
      a: env.next() * Math.PI * 2,
      energy: 1,
      eaten: 0,
      poisoned: 0,
      alive: true,
      diedAt: null,
      age: 0,
      depth: 0,
      children: 0,
      inputs: new Array(inputCount(w.rules)).fill(0),
      hidden: new Array(w.rules.hidden).fill(0),
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

  // src/engine/mode.ts
  function inEcosystem(w) {
    return w.rules.mode === 1 && w.generation > w.rules.ecoWarmup;
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
  function maybeSplit(w, child, instant = false) {
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
    if (w.rules.splitProof > 0 && !instant) {
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
    const eco = inEcosystem(w);
    w.families.set(id, newFamily(id, child.g, child.family, eco ? w.tick : w.generation + 1, eco));
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
  function newFamily(id, genome, parent, bornGeneration, bornInTicks = false) {
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
      protectedUntil: 0,
      bornInTicks,
      diedInTicks: false
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
    const { rules } = w;
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
        const child = newCreature(w, mutate(w, best.g, rules.mutation), fam.id, false, best.hue);
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
    fam.diedInTicks = inEcosystem(w);
    w.families.delete(fam.id);
    w.legacy.push(fam);
    if (w.legacy.length > LEGACY_LIMIT) w.legacy.splice(0, w.legacy.length - LEGACY_LIMIT);
  }
  function brainDistance(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s / a.length);
  }

  // src/engine/life.ts
  var POISON_HIT = 0.5;
  function live(w, c, costFactor) {
    const walls = w.rules.walls > 0;
    const seen = sense(w, c);
    c.inputs = seen.inputs;
    const { hidden, out } = think(c.g, c.inputs);
    c.hidden = hidden;
    c.out = out;
    const speed2 = (out[1] + 1) / 2 * 3;
    c.a += out[0] * 0.2;
    if (walls) {
      c.x = Math.min(Math.max(c.x + cos(c.a) * speed2, 0), W);
      c.y = Math.min(Math.max(c.y + sin(c.a) * speed2, 0), H);
    } else {
      c.x = (c.x + cos(c.a) * speed2 + W) % W;
      c.y = (c.y + sin(c.a) * speed2 + H) % H;
    }
    c.energy -= (5e-4 + speed2 * 4e-4) * w.rules.energyCost * costFactor;
    if (seen.food && seen.foodDist < 6) {
      if (seen.food.poison) {
        c.poisoned++;
        c.energy -= POISON_HIT;
      } else {
        c.eaten++;
        c.energy = Math.min(c.energy + 0.3, 1.5);
      }
      Object.assign(seen.food, newFood(w, seen.food.poison));
      if (w.rules.regrow > 0) seen.food.readyAt = w.tick + w.rules.regrow;
    }
    if (c.energy <= 0) {
      c.alive = false;
      c.diedAt = w.tick;
    }
  }

  // src/engine/ecosystem.ts
  var ECO_SAMPLE = 100;
  var RESCUE = 40;
  var MAX_POP = 1e3;
  var PAIR_RANGE = 30;
  var KEEP_DEATHS = 200;
  function stepEcosystem(w) {
    const { rules } = w;
    const scale = rules.ageScale;
    for (const c of w.creatures) {
      if (!c.alive) continue;
      live(w, c, scale > 0 ? 1 + c.age / scale : 1);
      c.age++;
    }
    const born = [];
    const room = () => w.creatures.length + born.length < MAX_POP;
    const ready = (c) => c.alive && c.energy >= rules.birthEnergy;
    if (rules.birth === 1) {
      const walls = rules.walls > 0;
      const used = /* @__PURE__ */ new Set();
      for (const a of w.creatures) {
        if (!room()) break;
        if (used.has(a) || !ready(a)) continue;
        let partner = null;
        let best = PAIR_RANGE * PAIR_RANGE;
        for (const b of w.creatures) {
          if (b === a || used.has(b) || !ready(b)) continue;
          const dx = offset(b.x - a.x, W, walls);
          const dy = offset(b.y - a.y, H, walls);
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            partner = b;
          }
        }
        if (!partner) continue;
        used.add(a);
        used.add(partner);
        const p = partner;
        const mixed = a.g.map((x, k) => w.rng.next() < 0.5 ? x : p.g[k]);
        const fromA = a.energy / 3;
        const fromB = p.energy / 3;
        a.energy -= fromA;
        p.energy -= fromB;
        p.children++;
        born.push(makeChild(w, a, mutate(w, mixed, rules.mutation), fromA + fromB));
      }
    } else {
      for (const a of w.creatures) {
        if (!room()) break;
        if (!ready(a)) continue;
        const half = a.energy / 2;
        a.energy -= half;
        born.push(makeChild(w, a, mutate(w, a.g, rules.mutation), half));
      }
    }
    const alive = [];
    for (const c of w.creatures) {
      if (c.alive) {
        alive.push(c);
        continue;
      }
      w.eco.deaths++;
      if (scale > 0 && c.age >= scale) w.eco.oldAge++;
      w.eco.recentDeaths.push({ x: c.x, y: c.y, tick: w.tick });
    }
    if (w.eco.recentDeaths.length > KEEP_DEATHS) w.eco.recentDeaths.splice(0, w.eco.recentDeaths.length - KEEP_DEATHS);
    w.creatures = alive.concat(born);
    if (w.creatures.length === 0) rescue(w);
    const present = new Set(w.creatures.map((c) => c.family));
    for (const fam of [...w.families.values()]) if (!present.has(fam.id)) retire(w, fam, w.tick);
    w.tick++;
    if (w.tick % ECO_SAMPLE === 0) sample(w);
  }
  function makeChild(w, parent, genome, energy) {
    const child = newCreature(w, genome, parent.family, false, parent.hue);
    const walls = w.rules.walls > 0;
    const place = (v, size) => walls ? Math.min(Math.max(v, 0), size) : (v + size) % size;
    child.x = place(parent.x + (w.env.next() - 0.5) * 10, W);
    child.y = place(parent.y + (w.env.next() - 0.5) * 10, H);
    child.energy = energy;
    child.depth = parent.depth + 1;
    parent.children++;
    maybeSplit(w, child, true);
    w.eco.births++;
    return child;
  }
  function rescue(w) {
    const { rules } = w;
    for (let i = 0; i < RESCUE; i++) {
      const genome = Array.from({ length: genomeSize(inputCount(rules), rules.hidden) }, () => w.rng.gauss() * 0.5);
      const id = w.nextFamilyId++;
      w.families.set(id, newFamily(id, genome, null, w.tick, true));
      w.creatures.push(newCreature(w, genome, id, false, null));
    }
    w.eco.rescues++;
  }
  function sample(w) {
    const n = w.creatures.length;
    w.eco.popHist.push(n);
    w.eco.ageHist.push(n ? w.creatures.reduce((s, c) => s + c.age, 0) / n : 0);
    const sizes = /* @__PURE__ */ new Map();
    for (const c of w.creatures) sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
    for (const [id, size] of sizes) {
      const fam = w.families.get(id);
      if (fam && size > fam.peakSize) fam.peakSize = size;
    }
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
    protectGens: 3,
    mutationRate: 1,
    centreShare: 0,
    hidden: 6,
    poison: 0.3,
    regrow: 0,
    energyCost: 1,
    // poison on: creatures visibly learn to avoid it (5% of intake vs 30% blind)
    mode: 0,
    birth: 0,
    birthEnergy: 1.2,
    ageScale: 3e3,
    ecoWarmup: 20
  };
  function createWorld(seed, rules) {
    const w = {
      rules: { ...rules },
      rng: createRng(seed),
      env: createRng(envSeed(seed)),
      creatures: [],
      food: [],
      tick: 0,
      generation: 1,
      layout: 0,
      avgHist: [],
      bestHist: [],
      worstHist: [],
      topHalfHist: [],
      poisonHist: [],
      nextId: 0,
      families: /* @__PURE__ */ new Map(),
      legacy: [],
      nextFamilyId: rules.pop,
      splits: 0,
      branches: /* @__PURE__ */ new Map(),
      nextBranchId: 0,
      failedBranches: 0,
      newcomerCount: 0,
      eco: { births: 0, deaths: 0, oldAge: 0, rescues: 0, popHist: [], ageHist: [], recentDeaths: [] }
    };
    for (let i = 0; i < rules.pop; i++) {
      const genome = Array.from({ length: genomeSize(inputCount(rules), rules.hidden) }, () => w.rng.gauss() * 0.5);
      w.creatures.push(newCreature(w, genome, i, false, null));
      w.families.set(i, newFamily(i, genome, null, 1));
    }
    w.food = newFoodLayout(w);
    return w;
  }
  function step(w) {
    if (inEcosystem(w)) {
      stepEcosystem(w);
      return;
    }
    for (const c of w.creatures) if (c.alive) live(w, c, 1);
    w.tick++;
    if (w.tick >= w.rules.genTicks || w.creatures.every((c) => !c.alive)) {
      if (w.layout + 1 < w.rules.layouts) nextLayout(w);
      else nextGeneration(w);
    }
  }
  function nextLayout(w) {
    w.layout++;
    for (const c of w.creatures) {
      c.x = w.env.next() * W;
      c.y = w.env.next() * H;
      c.a = w.env.next() * Math.PI * 2;
      c.energy = 1;
      c.alive = true;
      c.diedAt = null;
    }
    w.food = newFoodLayout(w);
    w.tick = 0;
  }
  function envSeed(seed) {
    let h = Math.imul((seed | 0) ^ 1540483477, 668265261);
    h ^= h >>> 15;
    return Math.imul(h, 374761393) | 0;
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
    w.poisonHist.push(ranked.reduce((s, c) => s + c.poisoned, 0) / ranked.length / per);
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
    const centreBrain = rules.centreShare > 0 ? centre(ranked, parents) : null;
    while (next.length < rules.pop) {
      const fromCentre = centreBrain !== null && (rules.centreShare >= 1 || rng.next() < rules.centreShare);
      const p = fromCentre ? ranked[0] : ranked[Math.floor(rng.next() * parents)];
      const child = newCreature(w, mutate(w, fromCentre ? centreBrain : p.g, rules.mutation), p.family, false, p.hue);
      child.branch = p.branch;
      maybeSplit(w, child);
      next.push(child);
    }
    w.creatures = next;
    settleLineage(w, proven);
    w.food = newFoodLayout(w);
    w.tick = 0;
    w.layout = 0;
    w.generation++;
  }

  // src/web/main.ts
  var $ = (id) => document.getElementById(id);
  var ctx2d = (id) => $(id).getContext("2d");
  var worldCtx = ctx2d("world");
  var chartCtx = ctx2d("chart");
  var famCtx = ctx2d("families");
  var brainCtx = ctx2d("brain");
  var css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  var C = {
    field: css("--field"),
    food: css("--food"),
    poison: css("--poison"),
    text: css("--text"),
    muted: css("--muted"),
    line: css("--line"),
    pos: css("--pos"),
    neg: css("--neg"),
    panel: css("--panel")
  };
  var FONT = '"IBM Plex Sans", system-ui, sans-serif';
  var hsl = (hue) => `hsl(${hue} 62% 64%)`;
  var world;
  var speed = 1;
  var selectedId = null;
  var pendingRules = { ...DEFAULT_RULES };
  var marks = [];
  var markedIds = /* @__PURE__ */ new Set();
  var marksKey = "";
  var mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  var food = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
  function updateMarks() {
    if (inEcosystem(world)) {
      marks = world.eco.recentDeaths;
      return;
    }
    const key = `${world.generation}:${world.layout}`;
    if (key !== marksKey) {
      marks = [];
      markedIds = /* @__PURE__ */ new Set();
      marksKey = key;
    }
    for (const c of world.creatures) {
      if (!c.alive && !markedIds.has(c.id)) {
        markedIds.add(c.id);
        marks.push({ x: c.x, y: c.y, tick: c.diedAt ?? world.tick });
      }
    }
  }
  function drawWorld(selected) {
    const ctx = worldCtx;
    ctx.fillStyle = C.field;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1.5;
    for (const f of world.food) {
      if (f.readyAt > world.tick) continue;
      ctx.beginPath();
      if (f.poison) {
        ctx.strokeStyle = C.poison;
        ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = C.food;
        ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = C.neg;
    ctx.lineWidth = 1.5;
    for (const m of marks) {
      if (inEcosystem(world) && world.tick - m.tick > 600) continue;
      ctx.globalAlpha = Math.max(0.15, 0.7 - (world.tick - m.tick) / 600);
      ctx.beginPath();
      ctx.moveTo(m.x - 3.5, m.y - 3.5);
      ctx.lineTo(m.x + 3.5, m.y + 3.5);
      ctx.moveTo(m.x + 3.5, m.y - 3.5);
      ctx.lineTo(m.x - 3.5, m.y + 3.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const c of world.creatures) {
      if (!c.alive) continue;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.globalAlpha = 0.45 + Math.min(c.energy, 1) * 0.55;
      ctx.fillStyle = hsl(c.hue);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, 4.5);
      ctx.lineTo(-5, -4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (world.rules.walls) {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W - 4, H - 4);
    }
    if (selected && selected.alive) {
      drawSightLines(selected);
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  function drawSightLines(c) {
    const ctx = worldCtx;
    const r = world.rules;
    const walls = r.walls > 0;
    const line = (dx, dy, color, dash) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + dx, c.y + dy);
      ctx.stroke();
    };
    const scan = scanFood(world, c.x, c.y, r.senseFood2 ? 2 : 1);
    const foods = scan.good;
    if (foods[0]) line(foods[0].dx, foods[0].dy, C.food, []);
    if (r.senseFood2 && foods[1]) line(foods[1].dx, foods[1].dy, C.food, [6, 5]);
    if (scan.poison) line(scan.poison.dx, scan.poison.dy, C.poison, [6, 5]);
    if (r.senseCreature) {
      const n = nearest(world.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
      if (n) line(n.dx, n.dy, hsl(n.item.hue), [2, 4]);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  function drawChart() {
    $("chartTitle").textContent = inEcosystem(world) ? "Population over time" : "Food eaten per layout, each generation";
    $("bandLegend").style.display = inEcosystem(world) ? "none" : "";
    $("lineLegend").textContent = inEcosystem(world) ? "Creatures alive" : "Average";
    if (inEcosystem(world)) return drawPopulationChart();
    const ctx = chartCtx;
    const w = 680, h = 300;
    const pad = { l: 44, r: 10, t: 12, b: 30 };
    const { avgHist, bestHist, worstHist } = world;
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);
    const max = Math.ceil(Math.max(5, ...bestHist));
    const n = bestHist.length;
    const x = (i) => pad.l + (n < 2 ? 0 : i / (n - 1) * (w - pad.l - pad.r));
    const y = (v) => h - pad.b - v / max * (h - pad.t - pad.b);
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    for (const v of [0, Math.round(max / 2), max]) {
      ctx.beginPath();
      ctx.moveTo(pad.l, y(v));
      ctx.lineTo(w - pad.r, y(v));
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(v), pad.l - 8, y(v) + 7);
    }
    ctx.textAlign = "left";
    if (n === 0) {
      ctx.fillText("Appears after the first generation", pad.l + 8, h / 2);
      return;
    }
    ctx.fillText("gen 1", pad.l, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(`gen ${n}`, w - pad.r, h - 6);
    ctx.fillStyle = C.pos;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    bestHist.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), y(worstHist[i]));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.pos;
    ctx.lineWidth = 3;
    ctx.beginPath();
    avgHist.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    ctx.stroke();
  }
  function drawPopulationChart() {
    const ctx = chartCtx;
    const w = 680, h = 300;
    const pad = { l: 44, r: 10, t: 12, b: 30 };
    const pop = world.eco.popHist.slice(-300);
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);
    const max = Math.max(10, ...pop);
    const n = pop.length;
    const x = (i) => pad.l + (n < 2 ? 0 : i / (n - 1) * (w - pad.l - pad.r));
    const y = (v) => h - pad.b - v / max * (h - pad.t - pad.b);
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    for (const v of [0, Math.round(max / 2), max]) {
      ctx.beginPath();
      ctx.moveTo(pad.l, y(v));
      ctx.lineTo(w - pad.r, y(v));
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(v), pad.l - 8, y(v) + 7);
    }
    ctx.textAlign = "left";
    if (n === 0) {
      ctx.fillText(`Appears after ${ECO_SAMPLE} ticks`, pad.l + 8, h / 2);
      return;
    }
    ctx.fillText(`tick ${(world.eco.popHist.length - n) * ECO_SAMPLE}`, pad.l, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(`tick ${world.eco.popHist.length * ECO_SAMPLE}`, w - pad.r, h - 6);
    ctx.strokeStyle = C.pos;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pop.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    ctx.stroke();
  }
  function drawFamilies() {
    const living = world.creatures.filter((c) => c.alive);
    const counts = /* @__PURE__ */ new Map();
    for (const c of living) counts.set(c.family, (counts.get(c.family) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    const ctx = famCtx;
    const w = 680, h = 28;
    ctx.clearRect(0, 0, w, h);
    if (living.length === 0) {
      $("familyText").textContent = "No one is alive. A new generation starts next tick.";
      return;
    }
    let x = 0;
    for (const [fam, n] of sorted) {
      const width = n / living.length * w;
      ctx.fillStyle = hsl(founderHue(fam));
      ctx.fillRect(x, 0, Math.max(width - 2, 1), h);
      x += width;
    }
    const lead = sorted[0];
    const newest = [...world.families.values()].reduce(
      (a, f) => f.parent !== null && !f.newcomer && (!a || f.id > a.id) ? f : a,
      null
    );
    const crowns = [...world.families.values()].flatMap((f) => f.champions.map((ch) => ({ fam: f.id, gen: ch.generation })));
    const lastCrown = crowns.sort((a, b) => b.gen - a.gen)[0];
    const crownText = lastCrown ? ` Latest champion: family ${lastCrown.fam + 1} adopted its champion's brain in generation ${lastCrown.gen}.` : "";
    const trials = [...world.branches.values()];
    const proof = world.rules.splitProof;
    const trialText = proof > 0 ? ` ${trials.length ? `${trials.length} branch${trials.length > 1 ? "es are" : " is"} on trial (best: family ${trials.reduce((a, b) => b.wins > a.wins ? b : a).family + 1}'s, ${Math.max(...trials.map((b) => b.wins))} of ${proof} wins)` : "No branch is on trial"}; ${world.failedBranches} failed so far.` : "";
    $("familyText").textContent = (sorted.length === 1 ? "1 family has" : `${sorted.length} families have`) + ` living members. The biggest is ${Math.round(lead[1] / living.length * 100)}% of the living. ` + (world.splits === 1 ? "1 new family has" : `${world.splits} new families have`) + " split off this run" + (newest ? `; the newest is family ${newest.id + 1}, from family ${newest.parent + 1} ${newest.bornInTicks ? "at tick" : "in generation"} ${newest.bornGeneration}.` : ".") + (inEcosystem(world) ? "" : trialText + newcomerText() + crownText);
  }
  function newcomerText() {
    if (!world.rules.newcomers && !world.newcomerCount) return "";
    const prot = [...world.families.values()].filter((f) => f.newcomer && world.generation < f.protectedUntil);
    const list = prot.map((f) => `family ${f.id + 1} (${f.protectedUntil - world.generation} more)`).join(", ");
    return ` ${world.newcomerCount} newcomer famil${world.newcomerCount === 1 ? "y" : "ies"} so far` + (prot.length ? `; protected now: ${list}.` : ".");
  }
  var legacyShown = -1;
  function drawLegacy() {
    if (world.legacy.length === legacyShown) return;
    legacyShown = world.legacy.length;
    const list = $("legacy");
    list.innerHTML = "";
    for (const f of world.legacy.slice(-6).reverse()) {
      const li = document.createElement("li");
      const from = f.parent === null ? "an original founder" : f.newcomer ? `a newcomer from family ${f.parent + 1}` : `from family ${f.parent + 1}`;
      const champs = f.champions.length ? `, ${f.champions.length} champion${f.champions.length > 1 ? "s" : ""}` : "";
      li.innerHTML = `<span class="dot" style="background:${hsl(founderHue(f.id))}"></span>Family ${f.id + 1}, ${from}: ${f.bornInTicks ? "tick" : "generation"} ${f.bornGeneration} to ${f.diedInTicks ? "tick" : "generation"} ${f.diedGeneration}, peak ${f.peakSize} creature${f.peakSize === 1 ? "" : "s"}` + (inEcosystem(world) ? "" : `, average ${mean(f.avgHist).toFixed(1)}, best ${food(f.bestEaten)} food${champs}`);
      list.append(li);
    }
    $("legacyText").textContent = world.legacy.length ? `${world.legacy.length} families have died out this run. Newest first.` : "No family has died out yet.";
  }
  var OUT_LABELS = ["Turn", "Speed"];
  function drawBrain(c) {
    const ctx = brainCtx;
    const h = c && (c.inputs.length > 7 || c.hidden.length > 8) ? 600 : 440;
    if (ctx.canvas.height !== h) ctx.canvas.height = h;
    const w = 680;
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);
    ctx.font = `22px ${FONT}`;
    if (!c) {
      ctx.fillStyle = C.muted;
      ctx.textAlign = "center";
      ctx.fillText("Click a creature in the world", w / 2, h / 2);
      return;
    }
    const nIn = c.inputs.length;
    const nHid = c.hidden.length;
    const inLabels = inputLabels(world.rules);
    const rowY = (n, i) => 30 + (i + 0.5) * ((h - 60) / n);
    const radius = Math.min(15, (h - 60) / nIn * 0.38);
    const xs = [255, 420, 555];
    ctx.font = `${nIn > 7 ? 20 : 22}px ${FONT}`;
    const layers = [
      c.inputs.map((v, i) => ({ x: xs[0], y: rowY(nIn, i), v })),
      c.hidden.map((v, i) => ({ x: xs[1], y: rowY(nHid, i), v })),
      c.out.map((v, i) => ({ x: xs[2], y: rowY(OUT, i), v }))
    ];
    let k = 0;
    const edge = (a, b, wgt) => {
      ctx.strokeStyle = wgt >= 0 ? C.pos : C.neg;
      ctx.globalAlpha = 0.15 + Math.min(Math.abs(wgt), 2) * 0.35;
      ctx.lineWidth = 1 + Math.min(Math.abs(wgt), 3) * 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    for (let hI = 0; hI < nHid; hI++) {
      for (let i = 0; i < nIn; i++) edge(layers[0][i], layers[1][hI], c.g[k++]);
      k++;
    }
    for (let o = 0; o < OUT; o++) {
      for (let hI = 0; hI < nHid; hI++) edge(layers[1][hI], layers[2][o], c.g[k++]);
      k++;
    }
    ctx.globalAlpha = 1;
    for (const [li, layer] of layers.entries()) {
      const rad = li === 0 ? radius : li === 1 ? Math.min(15, (h - 60) / nHid * 0.38) : 15;
      for (const node of layer) {
        const v = Math.max(-1, Math.min(1, node.v));
        ctx.fillStyle = C.field;
        ctx.beginPath();
        ctx.arc(node.x, node.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = v >= 0 ? C.pos : C.neg;
        ctx.globalAlpha = Math.abs(v);
        ctx.beginPath();
        ctx.arc(node.x, node.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.fillStyle = C.text;
    ctx.textAlign = "right";
    layers[0].forEach((n, i) => ctx.fillText(inLabels[i] ?? "", n.x - radius - 10, n.y + 6));
    ctx.textAlign = "left";
    ctx.font = `22px ${FONT}`;
    layers[2].forEach((n, i) => ctx.fillText(OUT_LABELS[i], n.x + 26, n.y + 7));
  }
  function brainCaption(c, picked) {
    if (!c) return "";
    if (inEcosystem(world)) {
      const who2 = picked ? "Your pick" : "The oldest creature";
      const famE = world.families.get(c.family);
      const fromE = famE && famE.parent !== null ? ` (split from family ${famE.parent + 1} ${famE.bornInTicks ? "at tick" : "in generation"} ${famE.bornGeneration})` : "";
      return `${who2}. Family ${c.family + 1}${fromE}, age ${c.age}, ${c.depth} generation${c.depth === 1 ? "" : "s"} from its founder, ${c.children} child${c.children === 1 ? "" : "ren"}, ate ${c.eaten}` + (world.rules.poison > 0 ? ` (and ${c.poisoned} poison)` : "") + `, energy ${c.energy.toFixed(2)}.`;
    }
    const who = picked ? "Your pick" : "Last generation's best, copied unchanged";
    const state = c.alive ? `energy ${c.energy.toFixed(2)}` : `starved at tick ${c.diedAt}`;
    const fam = world.families.get(c.family);
    const origin = !fam || fam.parent === null ? "" : fam.newcomer ? ` (newcomer from family ${fam.parent + 1} in generation ${fam.bornGeneration}` + (world.generation < fam.protectedUntil ? `, protected ${fam.protectedUntil - world.generation} more generation${fam.protectedUntil - world.generation === 1 ? "" : "s"})` : ")") : ` (split from family ${fam.parent + 1} in generation ${fam.bornGeneration})`;
    const branch = c.branch !== null ? world.branches.get(c.branch) : void 0;
    const trial = branch ? ` On trial as a new branch since generation ${branch.bornGeneration}: out-ate the rest of its family ${branch.wins} of ${world.rules.splitProof} generations in a row.` : "";
    const streak = c.streak > 0 ? ` On top ${c.streak} generation${c.streak > 1 ? "s" : ""} in a row.` : "";
    const champ = fam?.champions.length ? ` Its family's main brain is a champion from generation ${fam.champions.at(-1).generation}.` : "";
    const ate = world.rules.layouts > 1 ? `ate ${c.eaten} so far this generation (layout ${world.layout + 1} of ${world.rules.layouts})` : `ate ${c.eaten}`;
    const poisoned = world.rules.poison > 0 ? ` (and ${c.poisoned} poison)` : "";
    return `${who}. Family ${c.family + 1}${origin}, ${ate}${poisoned}, ${state}.${trial}${streak}${champ}`;
  }
  function draw() {
    updateMarks();
    let sel = world.creatures.find((c) => c.id === selectedId) ?? null;
    const picked = sel !== null;
    if (!sel) {
      sel = inEcosystem(world) ? world.creatures.reduce((a, c) => !a || c.age > a.age ? c : a, null) : world.creatures.find((c) => c.elite) ?? null;
    }
    drawWorld(sel);
    drawChart();
    drawFamilies();
    drawLegacy();
    drawBrain(sel);
    $("brainText").textContent = brainCaption(sel, picked);
    $("brainTitle").textContent = sel ? "Brain, live" : "Brain";
    if (inEcosystem(world)) {
      const e = world.eco;
      $("genText").textContent = `Tick ${world.tick}`;
      $("tickText").textContent = `Population ${world.creatures.length}. ${e.births} born, ${e.deaths} died (${e.oldAge} of old age).` + (e.rescues ? ` Everyone died ${e.rescues} time${e.rescues === 1 ? "" : "s"}; fresh founders were put in.` : "");
      return;
    }
    const alive = world.creatures.filter((c) => c.alive).length;
    const many = world.rules.layouts > 1;
    $("genText").textContent = world.rules.mode === 1 ? `Warm-up generation ${world.generation} of ${world.rules.ecoWarmup}` : `Generation ${world.generation}`;
    const layoutText = many ? `Food layout ${world.layout + 1} of ${world.rules.layouts}. ` : "";
    const last = world.avgHist.length ? ` Last generation: average ${world.avgHist.at(-1).toFixed(1)}, best ${food(world.bestHist.at(-1))}${many ? " food per layout" : ""}` + (world.rules.poison > 0 ? `, poison ${world.poisonHist.at(-1).toFixed(1)} each.` : ".") : "";
    $("tickText").textContent = `${layoutText}Tick ${world.tick} of ${world.rules.genTicks}, ${alive} of ${world.rules.pop} alive.${last}`;
  }
  function frame() {
    if (speed === "max") {
      const end = performance.now() + 12;
      do
        step(world);
      while (performance.now() < end);
    } else {
      for (let i = 0; i < speed; i++) step(world);
    }
    draw();
    requestAnimationFrame(frame);
  }
  function setSpeed(s) {
    speed = s;
    for (const b of document.querySelectorAll("#speeds button")) {
      b.setAttribute("aria-pressed", String(b.dataset.speed === String(s)));
    }
  }
  for (const b of document.querySelectorAll("#speeds button")) {
    b.onclick = () => setSpeed(b.dataset.speed === "max" ? "max" : Number(b.dataset.speed));
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
      e.preventDefault();
      setSpeed(speed === 0 ? 1 : 0);
    }
    if (e.key === "1") setSpeed(1);
    if (e.key === "2") setSpeed(10);
    if (e.key === "3") setSpeed("max");
  });
  $("world").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width);
    const y = (e.clientY - r.top) * (H / r.height);
    let best = null;
    let bd = 16 * 16;
    for (const c of world.creatures) {
      if (!c.alive) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    selectedId = best ? best.id : null;
  });
  var RULE_SPECS = [
    ["mode", "Ecosystem mode (no generations)", 0, 1, 1, "Creatures have children when full, age and die; the population follows the food. Needs slow regrowth: switching it on sets food regrowth to 100."],
    ["birth", "Children need two parents", 0, 1, 1, "Ecosystem: two full creatures within 30 px. Off = a full creature splits in two."],
    ["birthEnergy", "Energy needed for a child", 0.8, 1.5, 0.05, "Ecosystem. The most a creature can hold is 1.5."],
    ["ageScale", "Age at which living costs double", 0, 1e4, 500, "Ecosystem. 0 = no ageing."],
    ["ecoWarmup", "Warm-up generations before the ecosystem", 0, 50, 1, "Ecosystem starts with brains that can already eat. 0 = random brains (often die out)."],
    ["pop", "Creatures per generation", 10, 200, 1, ""],
    ["food", "Food on the map", 5, 200, 1, "Fewer = scarcer, harder to find."],
    ["genTicks", "Generation length (ticks)", 300, 5e3, 100, ""],
    ["mutation", "Mutation strength", 0, 1, 0.01, "How far a child's brain drifts from its parent's."],
    ["parents", "Parents (top N breed)", 1, 50, 1, "Lower = harsher selection."],
    ["elite", "Best copied unchanged", 0, 10, 1, "Keeps the best brains from being lost to mutation."],
    ["splitDistance", "New family when a brain differs by", 0, 2, 0.05, "From its family's main brain. Lower = more families. 0 = never split."],
    ["splitProof", "Branch must out-eat its family N generations in a row", 0, 10, 1, "Before it counts as a new family. 0 = new family right away."],
    ["championStreak", "Champion after N generations on top", 0, 10, 1, "Its brain becomes the family's main brain. 0 = never."],
    ["layouts", "Food layouts per generation", 1, 5, 1, "Each brain is scored on this many maps. More = fairer scores, slower generations."],
    ["hidden", "Middle neurons per brain", 2, 16, 1, "More = can learn more complex behaviour, but more weights to evolve."],
    ["mutationRate", "Share of weights each child changes", 0.05, 1, 0.05, "1 = every weight a little. Lower = only a few weights (sparse)."],
    ["centreShare", "Children from the centre brain", 0, 1, 0.1, "Evolution Strategies: a weighted average of the best family's top parents."],
    ["newcomers", "Newcomer families per generation", 0, 5, 1, "A good brain mutated very hard, starting its own family."],
    ["newcomerMutation", "How hard newcomers are mutated", 0, 3, 0.05, "Mutation strength for newcomers only."],
    ["protectGens", "Newcomers protected for N generations", 0, 10, 1, "Its best keeps a seat and has a child, whatever its rank."],
    ["poison", "Share of food that is poison", 0, 0.5, 0.05, "Purple rings. Cost 0.5 energy, worth nothing. Adds a poison sense."],
    ["regrow", "Food regrows after N ticks", 0, 600, 20, "0 = an eaten pellet reappears somewhere else at once."],
    ["energyCost", "Energy cost of living and moving", 0.5, 3, 0.1, "x normal. Higher = harsher."],
    ["senseFood2", "Sense the second-nearest food", 0, 1, 1, "Adds 3 inputs to the brain."],
    ["senseCreature", "Sense the nearest creature", 0, 1, 1, "Adds 3 inputs to the brain."],
    ["walls", "Walls instead of wrapping around", 0, 1, 1, "Adds a 'wall ahead' sense."]
  ];
  function renderRules() {
    const root = $("rules");
    root.innerHTML = "";
    for (const [key, label, min, max, stepV, help] of RULE_SPECS) {
      const id = `rule-${key}`;
      const div = document.createElement("div");
      div.className = "rule";
      if (max === 1 && stepV === 1) {
        div.classList.add("toggle");
        div.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" ${pendingRules[key] ? "checked" : ""}> ${label}</label>
        ${help ? `<small>${help}</small>` : ""}`;
        const box = div.querySelector("input");
        box.onchange = () => {
          pendingRules[key] = box.checked ? 1 : 0;
          if (key === "mode" && box.checked && pendingRules.regrow === 0) {
            pendingRules.regrow = 100;
            renderRules();
          }
          updatePending();
        };
        root.append(div);
        continue;
      }
      div.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${stepV}" value="${pendingRules[key]}">
      ${help ? `<small>${help}</small>` : ""}`;
      const input = div.querySelector("input");
      const out = div.querySelector("output");
      const show = () => out.textContent = ["mutation", "splitDistance", "newcomerMutation", "mutationRate", "centreShare", "poison", "energyCost", "birthEnergy"].includes(key) ? Number(input.value).toFixed(2) : input.value;
      input.oninput = () => {
        pendingRules[key] = Number(input.value);
        show();
        updatePending();
      };
      show();
      root.append(div);
    }
  }
  function updatePending() {
    const changed = Object.keys(pendingRules).some((k) => pendingRules[k] !== world.rules[k]);
    $("pending").textContent = changed ? "Changed rules apply when you start a new run." : "";
  }
  function startRun(seedText, rules) {
    world = createWorld(seedFrom(seedText), rules);
    selectedId = null;
    legacyShown = -1;
  }
  $("newRun").onclick = () => {
    startRun($("seed").value, pendingRules);
    updatePending();
  };
  startRun("42", DEFAULT_RULES);
  renderRules();
  setSpeed(1);
  frame();
  window.lab = { world: () => world };
})();

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
  function thinkInto(g, inputs, hidden, out) {
    let k = 0;
    const n = inputs.length;
    const nh = (g.length - OUT) / (n + 1 + OUT);
    if (hidden.length !== nh) hidden.length = nh;
    for (let h = 0; h < nh; h++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += inputs[i] * g[k++];
      hidden[h] = tanh(s + g[k++]);
    }
    for (let o = 0; o < OUT; o++) {
      let s = 0;
      for (let h = 0; h < nh; h++) s += hidden[h] * g[k++];
      out[o] = tanh(s + g[k++]);
    }
  }
  function learn(weights, trace, inputs, hidden, out, reward, rate, decay, rates = null, ratesAt = 0) {
    let k = 0;
    let change = 0;
    const step2 = (pre, post) => {
      trace[k] = decay * trace[k] + pre * post;
      if (reward !== 0) {
        const d = rate * reward * trace[k] * (rates ? rates[ratesAt + k] : 1);
        weights[k] += d;
        change += d < 0 ? -d : d;
      }
      k++;
    };
    for (let h = 0; h < hidden.length; h++) {
      for (let i = 0; i < inputs.length; i++) step2(inputs[i], hidden[h]);
      step2(1, hidden[h]);
    }
    for (let o = 0; o < out.length; o++) {
      for (let h = 0; h < hidden.length; h++) step2(hidden[h], out[o]);
      step2(1, out[o]);
    }
    return change;
  }

  // src/engine/breed.ts
  function mutate(w, g, size) {
    const { rng } = w;
    const rate = w.rules.mutationRate;
    if (rate >= 1) return g.map((x) => x + rng.gauss() * size);
    return g.map((x) => rng.next() < rate ? x + rng.gauss() * size : x);
  }
  function inherited(w, c) {
    if (c.w === c.g) return c.g;
    const share = w.rules.inheritLearned;
    const n = c.w.length;
    return c.g.map((x, k) => k < n ? x + share * (c.w[k] - x) : x);
  }
  function centre(w, ranked, parents) {
    const fam = ranked[0].family;
    const chosen = ranked.slice(0, parents).filter((c) => c.family === fam);
    const n = chosen.length;
    const weights = chosen.map((_, i) => log(n + 0.5) - log(i + 1));
    const total = weights.reduce((s, x) => s + x, 0);
    const out = new Array(chosen[0].g.length).fill(0);
    for (let i = 0; i < n; i++) {
      const wt = weights[i] / total;
      const g = inherited(w, chosen[i]);
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
  var CELL = 100;
  var GW = W / CELL;
  var GH = H / CELL;
  var MAX_R = Math.max(GW, GH);
  var RING_OX = [];
  var RING_OY = [];
  for (let r = 0; r <= MAX_R; r++) {
    const xs = [];
    const ys = [];
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        xs.push(ox);
        ys.push(oy);
      }
    }
    RING_OX.push(xs);
    RING_OY.push(ys);
  }
  var RINGS = MAX_R;
  var SPATIAL = { on: true, foodFrom: 128, creaturesFrom: 64 };
  function cellOf(x, y) {
    let cx = Math.floor(x / CELL);
    let cy = Math.floor(y / CELL);
    if (cx >= GW) cx = GW - 1;
    else if (cx < 0) cx = 0;
    if (cy >= GH) cy = GH - 1;
    else if (cy < 0) cy = 0;
    return cy * GW + cx;
  }
  function cellAt(home, ox, oy, walls) {
    const hx = home % GW;
    let cx = hx + ox;
    let cy = (home - hx) / GW + oy;
    if (walls) {
      if (cx < 0 || cx >= GW || cy < 0 || cy >= GH) return -1;
    } else {
      cx = (cx % GW + GW) % GW;
      cy = (cy % GH + GH) % GH;
    }
    return cy * GW + cx;
  }
  var Grid = class {
    cells = Array.from({ length: GW * GH }, () => []);
    where = [];
    // square of each item
    seen = new Int32Array(GW * GH);
    // visit stamps: with wrap-around, a big ring can repeat a square
    stamp = 0;
    build(items) {
      for (let k = 0; k < this.cells.length; k++) this.cells[k].length = 0;
      this.where.length = items.length;
      for (let i = 0; i < items.length; i++) {
        const k = cellOf(items[i].x, items[i].y);
        this.where[i] = k;
        this.cells[k].push(i);
      }
    }
    // Item i moved to (x, y).
    move(i, x, y) {
      const k = cellOf(x, y);
      const old = this.where[i];
      if (k === old) return;
      const list = this.cells[old];
      list.splice(list.indexOf(i), 1);
      this.cells[k].push(i);
      this.where[i] = k;
    }
    nextStamp() {
      if (++this.stamp === 2147483647) {
        this.seen.fill(0);
        this.stamp = 1;
      }
      return this.stamp;
    }
  };
  function nearestOneInto(hit, grid, items, x, y, walls, skipItem, skipDead) {
    let best = -1;
    let bdx = 0;
    let bdy = 0;
    let bd2 = Infinity;
    const halfW = W / 2;
    const halfH = H / 2;
    const home = cellOf(x, y);
    const stamp = grid.nextStamp();
    const seen = grid.seen;
    for (let r = 0; r <= RINGS; r++) {
      const rx = RING_OX[r];
      const ry = RING_OY[r];
      for (let t = 0; t < rx.length; t++) {
        const k = cellAt(home, rx[t], ry[t], walls);
        if (k < 0 || seen[k] === stamp) continue;
        seen[k] = stamp;
        const list = grid.cells[k];
        for (let n = 0; n < list.length; n++) {
          const j = list[n];
          const item = items[j];
          if (item === skipItem || skipDead && !item.alive) continue;
          let dx = item.x - x;
          let dy = item.y - y;
          if (!walls) {
            if (dx > halfW) dx -= W;
            else if (dx < -halfW) dx += W;
            if (dy > halfH) dy -= H;
            else if (dy < -halfH) dy += H;
          }
          const d2 = dx * dx + dy * dy;
          if (d2 < bd2 || d2 === bd2 && j < best) {
            best = j;
            bdx = dx;
            bdy = dy;
            bd2 = d2;
          }
        }
      }
      if (best >= 0 && bd2 < r * r * CELL * CELL) break;
    }
    if (best < 0) return false;
    hit.item = items[best];
    hit.dx = bdx;
    hit.dy = bdy;
    hit.d2 = bd2;
    return true;
  }
  function nearestBruteInto(hit, items, x, y, walls, skipItem, skipDead) {
    let best = -1;
    let bdx = 0;
    let bdy = 0;
    let bd2 = 0;
    const halfW = W / 2;
    const halfH = H / 2;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      if (item === skipItem || skipDead && !item.alive) continue;
      let dx = item.x - x;
      let dy = item.y - y;
      if (!walls) {
        if (dx > halfW) dx -= W;
        else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H;
        else if (dy < -halfH) dy += H;
      }
      const d2 = dx * dx + dy * dy;
      if (best < 0 || d2 < bd2) {
        best = j;
        bdx = dx;
        bdy = dy;
        bd2 = d2;
      }
    }
    if (best < 0) return false;
    hit.item = items[best];
    hit.dx = bdx;
    hit.dy = bdy;
    hit.d2 = bd2;
    return true;
  }

  // src/engine/senses.ts
  var sensesHunter = (r) => (r.hunters ?? 0) > 0 && (r.hunterSense ?? 1) > 0;
  function inputCount(r) {
    return IN + (r.senseFood2 ? 3 : 0) + (r.senseCreature ? 3 : 0) + (r.poison > 0 ? 3 : 0) + (sensesHunter(r) ? 3 : 0) + (r.walls ? 1 : 0);
  }
  function inputLabels(r) {
    const labels = ["Food left/right", "Food ahead", "Food distance", "Energy"];
    if (r.senseFood2) labels.push("2nd food left/right", "2nd food ahead", "2nd food distance");
    if (r.senseCreature) labels.push("Neighbour left/right", "Neighbour ahead", "Neighbour distance");
    if (r.poison > 0) labels.push("Poison left/right", "Poison ahead", "Poison distance");
    if (sensesHunter(r)) labels.push("Hunter left/right", "Hunter ahead", "Hunter distance");
    if (r.walls) labels.push("Wall distance ahead");
    return labels;
  }
  var NOTHING = [0, 0, 1];
  function wallAhead(x, y, heading) {
    const cx = cos(heading);
    const cy = sin(heading);
    const tx = cx > 0 ? (W - x) / cx : cx < 0 ? -x / cx : Infinity;
    const ty = cy > 0 ? (H - y) / cy : cy < 0 ? -y / cy : Infinity;
    return Math.min(Math.min(tx, ty) / 200, 1);
  }
  function looksPoison(w, f) {
    return f.poison !== w.swapped;
  }
  function newFoodHits() {
    const h = () => ({ item: null, dx: 0, dy: 0, d2: 0, idx: -1 });
    return { goodN: 0, good: [h(), h()], hasPoison: false, poison: h() };
  }
  function addGood(h, goodCount, f, j, dx, dy, d2, byIndex) {
    const g = h.good;
    let i = h.goodN;
    if (i === goodCount) {
      const last = g[i - 1];
      if (!(d2 < last.d2 || byIndex && d2 === last.d2 && j < last.idx)) return;
      i--;
    } else h.goodN++;
    while (i > 0 && (d2 < g[i - 1].d2 || byIndex && d2 === g[i - 1].d2 && j < g[i - 1].idx)) {
      const from = g[i - 1];
      const to = g[i];
      to.item = from.item;
      to.dx = from.dx;
      to.dy = from.dy;
      to.d2 = from.d2;
      to.idx = from.idx;
      i--;
    }
    const t = g[i];
    t.item = f;
    t.dx = dx;
    t.dy = dy;
    t.d2 = d2;
    t.idx = j;
  }
  function toScan(h) {
    const good = [];
    for (let i = 0; i < h.goodN; i++) good.push({ item: h.good[i].item, dx: h.good[i].dx, dy: h.good[i].dy, d2: h.good[i].d2 });
    const p = h.poison;
    return { good, poison: h.hasPoison ? { item: p.item, dx: p.dx, dy: p.dy, d2: p.d2 } : void 0 };
  }
  function scanFood(w, x, y, goodCount) {
    const h = newFoodHits();
    scanFoodInto(h, w, x, y, goodCount);
    return toScan(h);
  }
  function scanFoodInto(h, w, x, y, goodCount) {
    const walls = w.rules.walls > 0;
    const tick = w.tick;
    const swapped = w.swapped;
    const food2 = w.food;
    const halfW = W / 2;
    const halfH = H / 2;
    h.goodN = 0;
    h.hasPoison = false;
    const p = h.poison;
    for (let j = 0; j < food2.length; j++) {
      const f = food2[j];
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
      if (f.poison !== swapped) {
        if (!h.hasPoison || d2 < p.d2) {
          h.hasPoison = true;
          p.item = f;
          p.dx = dx;
          p.dy = dy;
          p.d2 = d2;
          p.idx = j;
        }
        continue;
      }
      addGood(h, goodCount, f, j, dx, dy, d2, false);
    }
  }
  var gridCache = /* @__PURE__ */ new WeakMap();
  function prepareGrids(w) {
    const foodOn = SPATIAL.on && w.food.length >= SPATIAL.foodFrom;
    const creaturesOn = SPATIAL.on && w.rules.senseCreature > 0 && w.creatures.length >= SPATIAL.creaturesFrom;
    if (!foodOn && !creaturesOn) {
      w.grids = null;
      return;
    }
    const g = gridCache.get(w) ?? { food: new Grid(), creatures: new Grid(), foodOn, creaturesOn, poisonLooks: 0 };
    gridCache.set(w, g);
    w.grids = g;
    g.foodOn = foodOn;
    g.creaturesOn = creaturesOn;
    if (foodOn) {
      g.food.build(w.food);
      let p = 0;
      for (let i = 0; i < w.food.length; i++) {
        w.food[i].slot = i;
        if (looksPoison(w, w.food[i])) p++;
      }
      g.poisonLooks = p;
    }
    if (creaturesOn) {
      g.creatures.build(w.creatures);
      for (let i = 0; i < w.creatures.length; i++) w.creatures[i].slot = i;
    }
  }
  function scanFoodGridInto(h, w, g, x, y, goodCount) {
    const walls = w.rules.walls > 0;
    const tick = w.tick;
    const food2 = w.food;
    const swapped = w.swapped;
    const halfW = W / 2;
    const halfH = H / 2;
    h.goodN = 0;
    h.hasPoison = false;
    const p = h.poison;
    const goodLooks = food2.length - g.poisonLooks;
    let goodSeen = 0;
    let poisonSeen = 0;
    const grid = g.food;
    const home = cellOf(x, y);
    const stamp = grid.nextStamp();
    const seen = grid.seen;
    for (let r = 0; r <= RINGS; r++) {
      const rx = RING_OX[r];
      const ry = RING_OY[r];
      for (let t = 0; t < rx.length; t++) {
        const k = cellAt(home, rx[t], ry[t], walls);
        if (k < 0 || seen[k] === stamp) continue;
        seen[k] = stamp;
        const list = grid.cells[k];
        for (let n = 0; n < list.length; n++) {
          const j = list[n];
          const f = food2[j];
          const isP = f.poison !== swapped;
          if (isP) poisonSeen++;
          else goodSeen++;
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
          if (isP) {
            if (!h.hasPoison || d2 < p.d2 || d2 === p.d2 && j < p.idx) {
              h.hasPoison = true;
              p.item = f;
              p.dx = dx;
              p.dy = dy;
              p.d2 = d2;
              p.idx = j;
            }
            continue;
          }
          addGood(h, goodCount, f, j, dx, dy, d2, true);
        }
      }
      const bound = r * r * CELL * CELL;
      const goodDone = goodSeen === goodLooks || h.goodN === goodCount && h.good[goodCount - 1].d2 < bound;
      const poisonDone = poisonSeen === g.poisonLooks || h.hasPoison && p.d2 < bound;
      if (goodDone && poisonDone) break;
    }
  }
  function writeTowards(inputs, k, dx, dy, d2, cosH, sinH) {
    const d = Math.sqrt(d2);
    const ok = d > 0 && d !== Infinity;
    const st = ok ? dy / d : 0;
    const ct = ok ? dx / d : 1;
    inputs[k] = st * cosH - ct * sinH;
    inputs[k + 1] = ct * cosH + st * sinH;
    inputs[k + 2] = Math.min(d / 200, 1);
    return k + 3;
  }
  function writeNothing(inputs, k) {
    inputs[k] = NOTHING[0];
    inputs[k + 1] = NOTHING[1];
    inputs[k + 2] = NOTHING[2];
    return k + 3;
  }
  var foodHits = newFoodHits();
  var creatureHit = { item: null, dx: 0, dy: 0, d2: 0 };
  var perceived = { food: null, foodDist: Infinity };
  function senseInto(w, c) {
    const r = w.rules;
    const walls = r.walls > 0;
    const g = w.grids;
    const h = foodHits;
    if (g !== null && g.foodOn) scanFoodGridInto(h, w, g, c.x, c.y, r.senseFood2 ? 2 : 1);
    else scanFoodInto(h, w, c.x, c.y, r.senseFood2 ? 2 : 1);
    const inputs = c.inputs;
    const cosH = cos(c.a);
    const sinH = sin(c.a);
    const f = h.goodN > 0 ? h.good[0] : null;
    let k = f ? writeTowards(inputs, 0, f.dx, f.dy, f.d2, cosH, sinH) : writeTowards(inputs, 0, 0, 0, Infinity, cosH, sinH);
    inputs[k++] = c.energy;
    if (r.senseFood2) {
      const s2 = h.goodN > 1 ? h.good[1] : null;
      k = s2 ? writeTowards(inputs, k, s2.dx, s2.dy, s2.d2, cosH, sinH) : writeNothing(inputs, k);
    }
    if (r.senseCreature) {
      const found = g !== null && g.creaturesOn ? nearestOneInto(creatureHit, g.creatures, w.creatures, c.x, c.y, walls, c, true) : nearestBruteInto(creatureHit, w.creatures, c.x, c.y, walls, c, true);
      k = found ? writeTowards(inputs, k, creatureHit.dx, creatureHit.dy, creatureHit.d2, cosH, sinH) : writeNothing(inputs, k);
    }
    const p = h.hasPoison ? h.poison : null;
    if (r.poison > 0) k = p ? writeTowards(inputs, k, p.dx, p.dy, p.d2, cosH, sinH) : writeNothing(inputs, k);
    if (sensesHunter(r) && r.hunterSense === 2) k = writeNothing(inputs, k);
    else if (sensesHunter(r)) {
      let bdx = 0;
      let bdy = 0;
      let bd2 = Infinity;
      for (const hu of w.hunters) {
        const dx = offset(hu.x - c.x, W, walls);
        const dy = offset(hu.y - c.y, H, walls);
        const d2 = dx * dx + dy * dy;
        if (d2 < bd2) {
          bd2 = d2;
          bdx = dx;
          bdy = dy;
        }
      }
      k = bd2 < Infinity ? writeTowards(inputs, k, bdx, bdy, bd2, cosH, sinH) : writeNothing(inputs, k);
    }
    if (walls) inputs[k++] = wallAhead(c.x, c.y, c.a);
    if (inputs.length !== k) inputs.length = k;
    const eat = p && (!f || p.d2 < f.d2) ? p : f;
    perceived.food = eat ? eat.item : null;
    perceived.foodDist = eat ? Math.sqrt(eat.d2) : Infinity;
    return perceived;
  }

  // src/engine/creature.ts
  function newFood(w, poison = false) {
    return { x: w.env.next() * W, y: w.env.next() * H, poison, readyAt: 0 };
  }
  function newFoodLayout(w) {
    w.swapped = w.rules.swapKinds > 0 && w.env.next() < 0.5;
    const poisonCount = Math.round(w.rules.poison * w.rules.food);
    return Array.from({ length: w.rules.food }, (_, i) => newFood(w, i < poisonCount));
  }
  function genomeLength(r) {
    const weights = genomeSize(inputCount(r), r.hidden);
    return r.plasticity > 0 ? weights * 2 : weights;
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
      // the working brain is the weights part only; its own copy when it can change during life
      w: w.rules.plasticity > 0 ? genome.slice(0, genome.length / 2) : w.rules.learnRate > 0 ? genome.slice() : genome,
      trace: w.rules.learnRate > 0 ? new Array(w.rules.plasticity > 0 ? genome.length / 2 : genome.length).fill(0) : [],
      learned: 0,
      usual: 0,
      x: env.next() * W,
      y: env.next() * H,
      a: env.next() * Math.PI * 2,
      energy: 1,
      eaten: 0,
      poisoned: 0,
      toxin: 0,
      resist: 0,
      caught: 0,
      alive: true,
      diedAt: null,
      age: 0,
      depth: 0,
      children: 0,
      inputs: new Array(inputCount(w.rules)).fill(0),
      hidden: new Array(w.rules.hidden).fill(0),
      out: [0, 0],
      speed: 0
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
    const genome = inherited(w, p).map((x) => x + rng.gauss() * rules.newcomerMutation);
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
        const keep = newCreature(w, inherited(w, best).slice(), fam.id, true, best.hue);
        keep.elite = false;
        keep.branch = best.branch;
        next.push(keep);
      }
      if (next.length < rules.pop) {
        const child = newCreature(w, mutate(w, inherited(w, best), rules.mutation), fam.id, false, best.hue);
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

  // src/engine/plants.ts
  var SPREAD_RANGE = 25;
  var PLANT_CAP = 3;
  var spreading = (w) => w.rules.foodSpread > 0 && inEcosystem(w);
  function spreadFood(w) {
    const r = w.rules;
    const food2 = w.food;
    const tick = w.tick;
    const walls = r.walls > 0;
    const place = (v, size) => walls ? Math.min(Math.max(v, 0), size) : (v + size) % size;
    const free = [[], []];
    const count = [0, 0];
    const active = [0, 0];
    for (let i = 0; i < food2.length; i++) {
      const f = food2[i];
      const k = f.poison ? 1 : 0;
      count[k]++;
      if (f.readyAt === Infinity) free[k].push(i);
      else if (f.readyAt <= tick) active[k]++;
    }
    const cap = [Math.round(r.food * PLANT_CAP), Math.round(Math.round(r.poison * r.food) * PLANT_CAP)];
    const n = food2.length;
    for (let i = 0; i < n; i++) {
      const f = food2[i];
      if (f.readyAt > tick) continue;
      if (w.env.next() >= r.foodSpread) continue;
      const k = f.poison ? 1 : 0;
      let slot = free[k].pop();
      if (slot === void 0) {
        if (count[k] >= cap[k]) continue;
        slot = food2.length;
        food2.push({ x: 0, y: 0, poison: f.poison, readyAt: 0 });
        count[k]++;
      }
      const a = w.env.next() * Math.PI * 2;
      const d = w.env.next() * SPREAD_RANGE;
      const s = food2[slot];
      s.x = place(f.x + cos(a) * d, W);
      s.y = place(f.y + sin(a) * d, H);
      s.readyAt = tick + 1;
    }
    for (const k of [0, 1]) {
      if (active[k] > 0 || !free[k].length) continue;
      const s = food2[free[k].pop()];
      s.x = w.env.next() * W;
      s.y = w.env.next() * H;
      s.readyAt = tick + 1;
    }
  }

  // src/engine/toxin.ts
  var LN2 = 0.6931471805599453;
  var newPoison = (w) => inEcosystem(w);
  var SICK = 0.1;
  function expNeg(q) {
    const t = tanh(q / 2);
    return (1 - t) / (1 + t);
  }
  function resistance(age, life, frail) {
    if (!(life > 0)) return 1;
    const z = (age - life / 2) / (life / 6);
    return frail + (1 - frail) * expNeg(z * z / 2);
  }
  var PREY_LIFE_RATE = 0.01;
  var preyLife = (w) => w.eco.preyLife;
  function notePreyDeath(w, age) {
    w.eco.preyLife = w.eco.preyLife > 0 ? w.eco.preyLife + PREY_LIFE_RATE * (age - w.eco.preyLife) : age;
  }
  function dose(amount, age, life, w) {
    return amount / resistance(age, life, w.rules.poisonFrail);
  }
  function fade(level, w) {
    return level > 0 ? level - level * LN2 / Math.max(1, w.rules.poisonHalfLife) : 0;
  }
  var harm = (level, resist) => level * (1 - resist);
  function train(resist, amount) {
    return resist + amount * (1 - resist);
  }
  function fadeResist(resist, w) {
    return resist > 0 ? resist - resist * LN2 / Math.max(1, w.rules.resistHalfLife) : 0;
  }

  // src/engine/life.ts
  var POISON_HIT = 0.5;
  var LEARN_DECAY = 0.9;
  var USUAL_RATE = 2e-3;
  function live(w, c, costFactor) {
    const walls = w.rules.walls > 0;
    const seen = senseInto(w, c);
    thinkInto(c.w, c.inputs, c.hidden, c.out);
    const hidden = c.hidden;
    const out = c.out;
    const speed2 = (out[1] + 1) / 2 * 3 / (newPoison(w) ? 1 + harm(c.toxin, c.resist) : 1);
    c.speed = speed2;
    c.a += out[0] * 0.2;
    if (walls) {
      c.x = Math.min(Math.max(c.x + cos(c.a) * speed2, 0), W);
      c.y = Math.min(Math.max(c.y + sin(c.a) * speed2, 0), H);
    } else {
      c.x = (c.x + cos(c.a) * speed2 + W) % W;
      c.y = (c.y + sin(c.a) * speed2 + H) % H;
    }
    if (w.grids?.creaturesOn) w.grids.creatures.move(c.slot, c.x, c.y);
    const sick = newPoison(w) ? 1 + harm(c.toxin, c.resist) : 1;
    c.energy -= (5e-4 + speed2 * 4e-4) * w.rules.energyCost * costFactor * sick;
    if (c.toxin > 0) c.toxin = fade(c.toxin, w);
    if (c.resist > 0) {
      c.energy -= w.rules.resistUpkeep * c.resist;
      c.resist = fadeResist(c.resist, w);
    }
    const near2 = w.measure && newPoison(w) ? countNearHunter(w, c) : false;
    let reward = 0;
    if (seen.food && seen.foodDist < 6) {
      reward = seen.food.poison ? -1 : 1;
      if (seen.food.poison) {
        c.poisoned++;
        if (newPoison(w)) {
          c.toxin += dose(w.rules.poisonDose, c.age, preyLife(w), w);
          c.resist = train(c.resist, w.rules.resistTrain);
          w.eco.sick.poisonEaten++;
          if (w.measure) countPoisonEaten(w, c, near2);
        } else c.energy -= POISON_HIT;
      } else {
        c.eaten++;
        c.energy = Math.min(c.energy + 0.3, 1.5);
      }
      if (spreading(w)) {
        seen.food.readyAt = w.tick + Math.max(1, w.rules.regrow);
      } else {
        Object.assign(seen.food, newFood(w, seen.food.poison));
        if (w.grids?.foodOn) w.grids.food.move(seen.food.slot, seen.food.x, seen.food.y);
        if (w.rules.regrow > 0) seen.food.readyAt = w.tick + w.rules.regrow;
      }
    }
    const r = w.rules;
    if (r.thinkCost > 0) {
      let busy = 0;
      for (const v of hidden) busy += v < 0 ? -v : v;
      c.energy -= r.thinkCost * busy / hidden.length;
    }
    if (r.learnRate > 0) {
      let felt = reward;
      if (r.relativeReward > 0) {
        felt = reward - c.usual;
        c.usual += USUAL_RATE * (reward - c.usual);
      }
      const rate = r.energyGate > 0 ? r.learnRate * Math.max(0, Math.min(c.energy / 1.5, 1)) : r.learnRate;
      const rates = r.plasticity > 0 ? c.g : null;
      const change = learn(c.w, c.trace, c.inputs, hidden, out, felt, rate, LEARN_DECAY, rates, c.w.length);
      c.learned += change;
      c.energy -= r.learnCost * change;
      if (r.forget > 0) for (let k = 0; k < c.w.length; k++) c.w[k] += r.forget * (c.g[k] - c.w[k]);
    }
    if (c.energy <= 0) {
      c.alive = false;
      c.diedAt = w.tick;
    }
  }
  var MEASURE_NEAR = 80;
  var MEASURE_WINDOW = 2e4;
  function measureWindow(w) {
    const m = w.eco.m;
    const wi = Math.floor(w.tick / MEASURE_WINDOW);
    while (m.win.length <= wi) m.win.push({ nearEat: 0, farEat: 0, nearTicks: 0, farTicks: 0 });
    return m.win[wi];
  }
  function measureFamily(w, c) {
    let f = w.eco.m.fam.get(c.family);
    if (!f) {
      f = { eat: 0, ticks: 0, nearEat: 0, nearTicks: 0 };
      w.eco.m.fam.set(c.family, f);
    }
    return f;
  }
  function countNearHunter(w, c) {
    const walls = w.rules.walls > 0;
    let near2 = false;
    for (const h of w.hunters) {
      let dx = h.x - c.x;
      let dy = h.y - c.y;
      if (!walls) {
        if (dx > W / 2) dx -= W;
        else if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        else if (dy < -H / 2) dy += H;
      }
      if (dx * dx + dy * dy < MEASURE_NEAR * MEASURE_NEAR) {
        near2 = true;
        break;
      }
    }
    const win = measureWindow(w);
    const f = measureFamily(w, c);
    f.ticks++;
    if (near2) {
      win.nearTicks++;
      f.nearTicks++;
    } else win.farTicks++;
    return near2;
  }
  function countPoisonEaten(w, c, near2) {
    const win = measureWindow(w);
    const f = measureFamily(w, c);
    f.eat++;
    if (near2) {
      win.nearEat++;
      f.nearEat++;
    } else win.farEat++;
  }

  // src/engine/hunters.ts
  var CATCH = 6;
  var REST = 30;
  var TURN = 0.2;
  var huntersArrived = (w) => w.rules.hunters > 0 && w.rules.mode !== 1 && w.generation >= w.rules.hunterFrom;
  function placeHunters(w) {
    w.hunters = [];
    if (!huntersArrived(w)) return;
    if (w.rules.hunterBrains > 0) {
      if (w.hunterBrains.length === 0) w.hunterBrains = firstHunterBrains(w);
      const pool = w.hunterBrains.length;
      const onMap = Math.min(w.rules.hunters, pool);
      const start = (w.generation * Math.max(1, w.rules.layouts) + w.layout) * onMap;
      for (let i = 0; i < onMap; i++) {
        const b = w.hunterBrains[(start + i) % pool];
        b.maps++;
        b.a = w.env.next() * Math.PI * 2;
        w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, brain: b, energy: 1, age: 0, toxin: 0, resist: 0 });
      }
      return;
    }
    for (let i = 0; i < w.rules.hunters; i++) w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0, brain: null, energy: 1, age: 0, toxin: 0, resist: 0 });
  }
  var hunterGenomeLength = (w) => genomeSize(inputCount(w.rules), w.rules.hidden);
  function newHunterBrain(w, g, origin, from) {
    return {
      id: w.nextHunterId++,
      g,
      origin,
      from,
      caught: 0,
      maps: 0,
      a: 0,
      w: w.rules.hunterLearn > 0 ? g.slice() : g,
      trace: w.rules.hunterLearn > 0 ? new Array(g.length).fill(0) : [],
      inputs: new Array(inputCount(w.rules)).fill(0),
      hidden: new Array(w.rules.hidden).fill(0),
      out: [0, 0]
    };
  }
  var poolSize = (w) => Math.max(w.rules.hunters, w.rules.hunterPool);
  function firstHunterBrains(w, n = poolSize(w)) {
    const len = hunterGenomeLength(w);
    const dead = w.legacy.filter((f) => f.ref.length >= len).reverse();
    const out = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0 && used < dead.length) {
        const fam = dead[used++];
        out.push(newHunterBrain(w, fam.ref.slice(0, len), "borrowed", fam.id));
      } else {
        out.push(newHunterBrain(w, Array.from({ length: len }, () => w.hrng.gauss() * 0.5), "random", null));
      }
    }
    return out;
  }
  function moveHunters(w) {
    if (w.rules.hunterBrains > 0 || inEcosystem(w)) moveBrainHunters(w);
    else moveChasers(w);
  }
  function moveChasers(w) {
    const walls = w.rules.walls > 0;
    const speed2 = w.rules.hunterSpeed;
    for (const h of w.hunters) {
      if (h.rest > 0) {
        h.rest--;
        continue;
      }
      let prey = null;
      let bdx = 0;
      let bdy = 0;
      let bd2 = Infinity;
      for (const c of w.creatures) {
        if (!c.alive) continue;
        const dx = offset(c.x - h.x, W, walls);
        const dy = offset(c.y - h.y, H, walls);
        const d2 = dx * dx + dy * dy;
        if (d2 < bd2) {
          bd2 = d2;
          bdx = dx;
          bdy = dy;
          prey = c;
        }
      }
      if (!prey) continue;
      const d = Math.sqrt(bd2);
      const step2 = Math.min(speed2, d);
      if (d > 0) {
        const nx = h.x + bdx / d * step2;
        const ny = h.y + bdy / d * step2;
        h.x = walls ? Math.min(Math.max(nx, 0), W) : (nx + W) % W;
        h.y = walls ? Math.min(Math.max(ny, 0), H) : (ny + H) % H;
      }
      if (d - step2 < CATCH) catchPrey(w, h, prey);
    }
  }
  var SPIT_HALF = 0.5;
  var SPIT_TASTE = 0.25;
  var SPIT_WOUND = 0.3;
  function spitOut(w, h, prey) {
    if (!(w.rules.hunterSpit > 0 && prey.toxin > 0 && inEcosystem(w))) return false;
    if (w.hrng.next() >= prey.toxin / (prey.toxin + SPIT_HALF)) return false;
    prey.energy -= SPIT_WOUND;
    h.rest = REST;
    const taken = dose(prey.toxin * SPIT_TASTE, h.age, w.rules.hunterAge, w);
    h.toxin += taken;
    h.resist = train(h.resist, w.rules.hunterResistTrain * Math.min(1, taken));
    w.eco.spat++;
    return true;
  }
  function catchPrey(w, h, prey) {
    if (spitOut(w, h, prey)) return true;
    prey.alive = false;
    prey.diedAt = w.tick;
    prey.caught++;
    h.rest = REST;
    if (h.brain) h.brain.caught++;
    if (inEcosystem(w)) {
      h.energy = Math.min(h.energy + w.rules.hunterMeal, MAX_ENERGY);
      if (prey.toxin > 0) {
        const taken = dose(prey.toxin, h.age, w.rules.hunterAge, w);
        h.toxin += taken;
        h.resist = train(h.resist, w.rules.hunterResistTrain * Math.min(1, taken));
      }
      w.eco.caught++;
      w.eco.sick.caught++;
      if (prey.toxin > SICK) w.eco.sick.caughtSick++;
    }
    return false;
  }
  var near = { i1: -1, dx1: 0, dy1: 0, d21: Infinity, i2: -1, dx2: 0, dy2: 0, d22: Infinity };
  function nearestPrey(w, x, y, walls) {
    near.i1 = near.i2 = -1;
    near.d21 = near.d22 = Infinity;
    const cs = w.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.alive) continue;
      const dx = offset(c.x - x, W, walls);
      const dy = offset(c.y - y, H, walls);
      const d2 = dx * dx + dy * dy;
      if (d2 < near.d21) {
        near.i2 = near.i1;
        near.dx2 = near.dx1;
        near.dy2 = near.dy1;
        near.d22 = near.d21;
        near.i1 = i;
        near.dx1 = dx;
        near.dy1 = dy;
        near.d21 = d2;
      } else if (d2 < near.d22) {
        near.i2 = i;
        near.dx2 = dx;
        near.dy2 = dy;
        near.d22 = d2;
      }
    }
  }
  function moveBrainHunters(w) {
    const r = w.rules;
    const walls = r.walls > 0;
    const hs = w.hunters;
    const eco = inEcosystem(w);
    for (let n = 0; n < hs.length; n++) {
      const h = hs[n];
      const b = h.brain;
      if (h.rest > 0) {
        h.rest--;
        continue;
      }
      nearestPrey(w, h.x, h.y, walls);
      if (near.i1 < 0) continue;
      const inputs = b.inputs;
      const cosH = cos(b.a);
      const sinH = sin(b.a);
      let k = writeTowards(inputs, 0, near.dx1, near.dy1, near.d21, cosH, sinH);
      inputs[k++] = eco ? h.energy : 1;
      if (r.senseFood2) k = near.i2 >= 0 ? writeTowards(inputs, k, near.dx2, near.dy2, near.d22, cosH, sinH) : writeNothing(inputs, k);
      if (r.senseCreature) {
        let bdx = 0;
        let bdy = 0;
        let bd2 = Infinity;
        for (let m = 0; m < hs.length; m++) {
          if (m === n) continue;
          const dx = offset(hs[m].x - h.x, W, walls);
          const dy = offset(hs[m].y - h.y, H, walls);
          const d2 = dx * dx + dy * dy;
          if (d2 < bd2) {
            bd2 = d2;
            bdx = dx;
            bdy = dy;
          }
        }
        k = bd2 < Infinity ? writeTowards(inputs, k, bdx, bdy, bd2, cosH, sinH) : writeNothing(inputs, k);
      }
      if (r.poison > 0) {
        if (eco && r.hunterSeeSpeed > 0) {
          const p = w.creatures[near.i1];
          k = writeTowards(inputs, k, near.dx1, near.dy1, near.d21, cosH, sinH);
          inputs[k - 1] = Math.min(p.speed / 3, 1);
        } else k = writeNothing(inputs, k);
      }
      if (r.hunterSense > 0) k = writeNothing(inputs, k);
      if (walls) inputs[k++] = wallAhead(h.x, h.y, b.a);
      if (inputs.length !== k) inputs.length = k;
      thinkInto(b.w, inputs, b.hidden, b.out);
      b.a += b.out[0] * TURN;
      const speed2 = (b.out[1] + 1) / 2 * r.hunterSpeed;
      if (walls) {
        h.x = Math.min(Math.max(h.x + cos(b.a) * speed2, 0), W);
        h.y = Math.min(Math.max(h.y + sin(b.a) * speed2, 0), H);
      } else {
        h.x = (h.x + cos(b.a) * speed2 + W) % W;
        h.y = (h.y + sin(b.a) * speed2 + H) % H;
      }
      nearestPrey(w, h.x, h.y, walls);
      const toxinBefore = h.toxin;
      const caughtNow = near.i1 >= 0 && near.d21 < CATCH * CATCH;
      const spat = caughtNow && catchPrey(w, h, w.creatures[near.i1]);
      if (eco && r.hunterLearn > 0) {
        const reward = spat ? -1 : caughtNow ? 1 - 2 * Math.min(1, h.toxin - toxinBefore) : 0;
        learn(b.w, b.trace, inputs, b.hidden, b.out, reward, r.hunterLearn, LEARN_DECAY);
      }
    }
  }
  function breedHunters(w) {
    const bs = w.hunterBrains;
    if (bs.length === 0) return;
    const rate = (b) => b.maps > 0 ? b.caught / b.maps : -1;
    const ranked = [...bs].sort((a, b) => rate(b) - rate(a));
    const perMap = (xs) => {
      const maps = xs.reduce((s, b) => s + b.maps, 0);
      return maps > 0 ? xs.reduce((s, b) => s + b.caught, 0) / maps : null;
    };
    const avgOf = (o) => perMap(bs.filter((b) => b.origin === o));
    w.hunterHist.push({
      avg: perMap(bs) ?? 0,
      best: Math.max(0, rate(ranked[0])),
      borrowed: bs.filter((b) => b.origin === "borrowed").length / bs.length,
      avgBorrowed: avgOf("borrowed"),
      avgRandom: avgOf("random")
    });
    const n = poolSize(w);
    const parents = Math.max(1, Math.ceil(ranked.length / 2));
    const next = [newHunterBrain(w, ranked[0].g, ranked[0].origin, ranked[0].from)];
    while (next.length < n) {
      const p = ranked[Math.floor(w.hrng.next() * parents)];
      next.push(newHunterBrain(w, p.g.map((x) => x + w.hrng.gauss() * w.rules.mutation), p.origin, p.from));
    }
    w.hunterBrains = next;
  }
  var MAX_ENERGY = 1.5;
  var HUNTER_CAP = 300;
  var BEST_KEEP = 8;
  function remember(list, b) {
    if (list.length === BEST_KEEP && b.score <= list[list.length - 1].score) return;
    let i = list.length;
    while (i > 0 && b.score > list[i - 1].score) i--;
    list.splice(i, 0, b);
    if (list.length > BEST_KEEP) list.pop();
  }
  function newEcoHunter(w, brain, x, y, energy) {
    brain.a = w.hrng.next() * Math.PI * 2;
    return { x, y, rest: 0, brain, energy, age: 0, toxin: 0, resist: 0 };
  }
  function startEcoHunters(w) {
    w.hunters = firstHunterBrains(w, w.rules.hunters).map((b) => newEcoHunter(w, b, w.hrng.next() * W, w.hrng.next() * H, 1));
    w.eco.huntersStarted = true;
  }
  function liveEcoHunters(w) {
    const r = w.rules;
    const walls = r.walls > 0;
    const place = (v, size) => walls ? Math.min(Math.max(v, 0), size) : (v + size) % size;
    const born = [];
    for (const h of w.hunters) {
      h.energy -= r.hunterHunger * (1 + harm(h.toxin, h.resist)) + r.resistUpkeep * h.resist;
      h.toxin = fade(h.toxin, w);
      h.resist = fadeResist(h.resist, w);
      h.age++;
      const adult = h.age >= r.hunterMature;
      const fertile = adult ? 1 - (h.age - r.hunterMature) / Math.max(1, r.hunterAge - r.hunterMature) : 0;
      if (adult && h.energy >= r.hunterBirth && w.hunters.length + born.length < HUNTER_CAP && w.hrng.next() < r.hunterBirthChance * fertile) {
        const half = h.energy / 2;
        h.energy -= half;
        const p = h.brain;
        const child = newHunterBrain(w, p.g.map((x) => x + w.hrng.gauss() * r.mutation), p.origin, p.from);
        const baby = newEcoHunter(w, child, place(h.x + (w.hrng.next() - 0.5) * 10, W), place(h.y + (w.hrng.next() - 0.5) * 10, H), half);
        baby.resist = h.resist * r.resistInherit;
        born.push(baby);
        w.eco.hunterBirths++;
      }
    }
    const alive = [];
    for (const h of w.hunters) {
      const old = h.age >= r.hunterAge;
      if (h.energy > 0 && !old) {
        alive.push(h);
        continue;
      }
      w.eco.hunterDeaths++;
      if (old) w.eco.hunterOldAge++;
      const b = h.brain;
      remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from });
    }
    w.hunters = alive.concat(born);
  }
  function restartHunters(w) {
    const best = w.eco.bestHunters;
    w.hunters = [];
    for (let i = 0; i < w.rules.hunters; i++) {
      const src = best.length ? best[i % best.length] : null;
      const brain = src ? newHunterBrain(w, i < best.length ? src.g.slice() : src.g.map((x) => x + w.hrng.gauss() * w.rules.mutation), src.origin, src.from) : newHunterBrain(w, Array.from({ length: hunterGenomeLength(w) }, () => w.hrng.gauss() * 0.5), "random", null);
      w.hunters.push(newEcoHunter(w, brain, w.hrng.next() * W, w.hrng.next() * H, 1));
    }
  }
  function thinHunters(w) {
    const n = w.rules.hunters;
    const hs = w.hunters;
    if (hs.length <= n) return;
    const score = (h) => h.brain.caught;
    let best = hs[0];
    for (const h of hs) if (score(h) > score(best)) best = h;
    const mean2 = hs.reduce((s, h) => s + score(h), 0) / hs.length;
    const key = (h) => score(h) <= mean2 ? mean2 - score(h) : 1e9 + score(h) - mean2;
    const average = hs.filter((h) => h !== best).sort((a, b) => key(a) - key(b)).slice(0, Math.max(0, n - 2));
    const keep = n >= 1 ? [best, ...average] : [];
    for (const h of hs) {
      if (keep.includes(h)) continue;
      const b = h.brain;
      remember(w.eco.bestHunters, { g: b.g, score: b.caught, origin: b.origin, from: b.from });
    }
    if (n >= 2) {
      const g = Array.from({ length: hunterGenomeLength(w) }, () => w.hrng.gauss() * 0.5);
      keep.push(newEcoHunter(w, newHunterBrain(w, g, "random", null), w.hrng.next() * W, w.hrng.next() * H, 1));
    }
    w.hunters = keep;
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
    const hunting = rules.hunters > 0;
    if (spreading(w)) spreadFood(w);
    if (hunting && !w.eco.huntersStarted) {
      startEcoHunters(w);
      w.eco.roundStart = w.tick;
    }
    prepareGrids(w);
    for (const c of w.creatures) {
      if (!c.alive) continue;
      live(w, c, scale > 0 ? 1 + c.age / scale : 1);
      c.age++;
    }
    w.grids = null;
    if (hunting) moveHunters(w);
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
        const ga = inherited(w, a);
        const gb = inherited(w, p);
        const mixed = ga.map((x, k) => w.rng.next() < 0.5 ? x : gb[k]);
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
        born.push(makeChild(w, a, mutate(w, inherited(w, a), rules.mutation), half));
      }
    }
    const alive = [];
    for (const c of w.creatures) {
      if (c.alive) {
        alive.push(c);
        continue;
      }
      w.eco.deaths++;
      notePreyDeath(w, c.age);
      if (scale > 0 && c.age >= scale) w.eco.oldAge++;
      if (hunting) remember(w.eco.bestPrey, { g: c.g, score: c.age, origin: "random", from: c.family });
      w.eco.recentDeaths.push({ x: c.x, y: c.y, tick: w.tick });
    }
    if (w.eco.recentDeaths.length > KEEP_DEATHS) w.eco.recentDeaths.splice(0, w.eco.recentDeaths.length - KEEP_DEATHS);
    w.creatures = alive.concat(born);
    if (hunting) {
      liveEcoHunters(w);
      const preyGone = w.creatures.length === 0;
      const huntersGone = w.hunters.length === 0;
      if (preyGone || huntersGone) {
        w.eco.rounds.push({ start: w.eco.roundStart, end: w.tick, died: preyGone && huntersGone ? "both" : preyGone ? "prey" : "hunters" });
        w.eco.roundStart = w.tick;
        if (preyGone) restartPrey(w);
        if (preyGone && !huntersGone) thinHunters(w);
        if (huntersGone) restartHunters(w);
      }
    } else if (w.creatures.length === 0) rescue(w);
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
    child.resist = parent.resist * w.rules.resistInherit;
    child.depth = parent.depth + 1;
    parent.children++;
    maybeSplit(w, child, true);
    w.eco.births++;
    return child;
  }
  function rescue(w) {
    const { rules } = w;
    for (let i = 0; i < RESCUE; i++) {
      const genome = Array.from({ length: genomeLength(rules) }, () => w.rng.gauss() * 0.5);
      const id = w.nextFamilyId++;
      w.families.set(id, newFamily(id, genome, null, w.tick, true));
      w.creatures.push(newCreature(w, genome, id, false, null));
    }
    w.eco.rescues++;
  }
  function restartPrey(w) {
    const best = w.eco.bestPrey;
    if (!best.length) return rescue(w);
    const { rules } = w;
    const fams = best.map((b) => {
      const id = w.nextFamilyId++;
      w.families.set(id, newFamily(id, b.g, null, w.tick, true));
      return id;
    });
    for (let i = 0; i < RESCUE; i++) {
      const k = i % best.length;
      const genome = i < best.length ? best[k].g.slice() : mutate(w, best[k].g, rules.mutation);
      w.creatures.push(newCreature(w, genome, fams[k], false, null));
    }
    w.eco.rescues++;
  }
  function sample(w) {
    const n = w.creatures.length;
    if (w.rules.hunters > 0) w.eco.hunterPopHist.push(w.hunters.length);
    w.eco.popHist.push(n);
    w.eco.ageHist.push(n ? w.creatures.reduce((s, c) => s + c.age, 0) / n : 0);
    const t = w.eco.toxin;
    const life = preyLife(w);
    if (life > 0) {
      for (const c of w.creatures) {
        const b = c.age < life / 4 ? 0 : c.age > 3 * life / 4 ? 2 : 1;
        t.band[b] += c.toxin;
        t.bandN[b]++;
      }
    }
    if (n) {
      w.eco.sick.sickShare += w.creatures.filter((c) => c.toxin > SICK).length / n;
      w.eco.sick.samples++;
    }
    const rs = w.eco.resist;
    for (const c of w.creatures) rs.prey += c.resist;
    rs.preyN += n;
    for (const h of w.hunters) rs.hunter += h.resist;
    rs.hunterN += w.hunters.length;
    for (const h of w.hunters) {
      t.hunter += h.toxin;
      t.hunterN++;
      if (h.toxin > 0.05) t.hunterSick++;
    }
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
    ecoWarmup: 20,
    learnRate: 0,
    inheritLearned: 0.75,
    thinkCost: 0,
    learnCost: 0,
    forget: 2e-3,
    relativeReward: 1,
    energyGate: 0,
    swapKinds: 0,
    plasticity: 0,
    hunters: 0,
    hunterSense: 1,
    hunterSpeed: 2,
    hunterBrains: 0,
    hunterPool: 12,
    hunterFrom: 1,
    poisonDose: 1,
    poisonHalfLife: 500,
    poisonFrail: 0.25,
    hunterSeeSpeed: 1,
    hunterLearn: 0.02,
    hunterSpit: 0,
    resistTrain: 0,
    resistHalfLife: 2e3,
    resistInherit: 0.75,
    resistUpkeep: 2e-4,
    hunterResistTrain: 0,
    // off: no prey defence emerged (README 2026-10-26)
    foodSpread: 0,
    hunterHunger: 25e-4,
    hunterMeal: 0.5,
    hunterBirth: 1.4,
    hunterAge: 6e3,
    hunterMature: 1e3,
    hunterBirthChance: 0.03
    // tuned with food 120 (README 2026-10-23)
  };
  function createWorld(seed, rules, start) {
    const each = start && Array.isArray(start[0]) ? start : null;
    const one = start && !each ? start : null;
    for (const g of each ?? (one ? [one] : [])) {
      if (g.length !== genomeLength(rules)) {
        throw new Error(`This brain has ${g.length} weights; these rules need ${genomeLength(rules)} (different senses or brain size)`);
      }
    }
    if (each && each.length !== rules.pop) throw new Error(`${each.length} brains for ${rules.pop} creatures`);
    const w = {
      rules: { ...rules },
      seed,
      rng: createRng(seed),
      env: createRng(envSeed(seed)),
      creatures: [],
      food: [],
      tick: 0,
      generation: 1,
      layout: 0,
      swapped: false,
      grids: null,
      hunters: [],
      hunterBrains: [],
      hunterHist: [],
      nextHunterId: 0,
      hrng: createRng(hunterSeed(seed)),
      caughtHist: [],
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
      eco: {
        births: 0,
        deaths: 0,
        oldAge: 0,
        rescues: 0,
        popHist: [],
        ageHist: [],
        recentDeaths: [],
        huntersStarted: false,
        hunterPopHist: [],
        caught: 0,
        spat: 0,
        hunterBirths: 0,
        hunterDeaths: 0,
        hunterOldAge: 0,
        rounds: [],
        roundStart: 0,
        bestPrey: [],
        bestHunters: [],
        preyLife: 0,
        m: { win: [], fam: /* @__PURE__ */ new Map() },
        resist: { prey: 0, preyN: 0, hunter: 0, hunterN: 0 },
        sick: { caught: 0, caughtSick: 0, sickShare: 0, samples: 0, poisonEaten: 0 },
        toxin: { band: [0, 0, 0], bandN: [0, 0, 0], hunter: 0, hunterN: 0, hunterSick: 0 }
      },
      measure: false
    };
    for (let i = 0; i < rules.pop; i++) {
      const genome = each ? each[i].slice() : one ? one.slice() : Array.from({ length: genomeLength(rules) }, () => w.rng.gauss() * 0.5);
      w.creatures.push(newCreature(w, genome, i, false, null));
      w.families.set(i, newFamily(i, genome, null, 1));
    }
    startLayout(w);
    return w;
  }
  function step(w) {
    if (inEcosystem(w)) {
      stepEcosystem(w);
      return;
    }
    if (tickLayout(w)) {
      if (w.layout + 1 < w.rules.layouts) nextLayout(w);
      else nextGeneration(w);
    }
  }
  function tickLayout(w) {
    prepareGrids(w);
    for (const c of w.creatures) if (c.alive) live(w, c, 1);
    w.grids = null;
    if (w.hunters.length) moveHunters(w);
    w.tick++;
    return w.tick >= w.rules.genTicks || w.creatures.every((c) => !c.alive);
  }
  function nextLayout(w) {
    w.layout++;
    startLayout(w);
  }
  function startLayout(w) {
    w.env = createRng(layoutSeed(w.seed, w.generation, w.layout));
    for (const c of w.creatures) {
      c.x = w.env.next() * W;
      c.y = w.env.next() * H;
      c.a = w.env.next() * Math.PI * 2;
      c.energy = 1;
      c.alive = true;
      c.diedAt = null;
      if (c.w !== c.g) {
        for (let k = 0; k < c.w.length; k++) c.w[k] = c.g[k];
        c.trace.fill(0);
        c.usual = 0;
      }
    }
    w.food = newFoodLayout(w);
    if (huntersArrived(w)) placeHunters(w);
    else w.hunters = [];
    w.tick = 0;
  }
  function envSeed(seed) {
    let h = Math.imul((seed | 0) ^ 1540483477, 668265261);
    h ^= h >>> 15;
    return Math.imul(h, 374761393) | 0;
  }
  function hunterSeed(seed) {
    let h = Math.imul((seed | 0) ^ 1752526452, 2654435761);
    h ^= h >>> 16;
    return Math.imul(h, 2246822507) | 0;
  }
  function layoutSeed(seed, generation, layout) {
    let h = envSeed(seed);
    h = Math.imul(h ^ generation, 2654435761);
    h ^= h >>> 16;
    h = Math.imul(h ^ layout, 2246822507);
    h ^= h >>> 13;
    return h | 0;
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
    if (huntersArrived(w)) w.caughtHist.push(ranked.reduce((s, c) => s + c.caught, 0) / ranked.length / per);
    if (rules.hunterBrains > 0) breedHunters(w);
    const elite = Math.min(rules.elite, rules.pop);
    const parents = Math.max(1, Math.min(rules.parents, rules.pop));
    const next = [];
    recordFamilyStats(w, ranked, per);
    const proven = judgeBranches(w, ranked);
    for (let i = 0; i < elite; i++) {
      const copy = newCreature(w, inherited(w, ranked[i]).slice(), ranked[i].family, true, ranked[i].hue);
      copy.streak = ranked[i].streak + 1;
      copy.branch = ranked[i].branch;
      next.push(copy);
    }
    crownChampions(w, next);
    protectNewcomers(w, ranked, next, elite);
    for (let i = 0; i < rules.newcomers && next.length < rules.pop; i++) addNewcomer(w, ranked, next, parents);
    const centreBrain = rules.centreShare > 0 ? centre(w, ranked, parents) : null;
    while (next.length < rules.pop) {
      const fromCentre = centreBrain !== null && (rules.centreShare >= 1 || rng.next() < rules.centreShare);
      const p = fromCentre ? ranked[0] : ranked[Math.floor(rng.next() * parents)];
      const child = newCreature(w, mutate(w, fromCentre ? centreBrain : inherited(w, p), rules.mutation), p.family, false, p.hue);
      child.branch = p.branch;
      maybeSplit(w, child);
      next.push(child);
    }
    w.creatures = next;
    settleLineage(w, proven);
    w.layout = 0;
    w.generation++;
    startLayout(w);
  }

  // src/web/fame.ts
  var FAME_LIMIT = 50;
  var KEY = "evolution-lab.hall-of-fame";
  function parseFame(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Not a hall-of-fame file (expected a list of brains)");
    const out = [];
    for (const e of data) {
      if (!e || typeof e !== "object") continue;
      const genome = e.genome;
      if (!Array.isArray(genome) || genome.length === 0 || !genome.every((x) => typeof x === "number" && Number.isFinite(x))) continue;
      const rules = { ...DEFAULT_RULES };
      if (e.rules && typeof e.rules === "object") {
        for (const k of Object.keys(DEFAULT_RULES)) {
          const v = e.rules[k];
          if (typeof v === "number" && Number.isFinite(v)) rules[k] = v;
        }
      }
      const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
      out.push({
        id: typeof e.id === "string" ? e.id : `${Date.now().toString(36)}-${out.length}`,
        name: typeof e.name === "string" ? e.name.slice(0, 80) : "Saved brain",
        savedAt: typeof e.savedAt === "string" ? e.savedAt : "",
        seed: typeof e.seed === "string" ? e.seed : "42",
        generation: num(e.generation, 0),
        eaten: num(e.eaten, 0),
        hue: num(e.hue, 0),
        rules,
        genome
      });
    }
    return out;
  }
  function mergeFame(a, b) {
    const seen = /* @__PURE__ */ new Set();
    return [...a, ...b].filter((e) => seen.has(e.id) ? false : (seen.add(e.id), true)).sort((x, y) => y.savedAt > x.savedAt ? 1 : y.savedAt < x.savedAt ? -1 : 0).slice(0, FAME_LIMIT);
  }
  function loadFame() {
    try {
      const text = localStorage.getItem(KEY);
      return { list: text ? parseFame(text) : [], stored: true };
    } catch {
      return { list: [], stored: false };
    }
  }
  function storeFame(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  // src/web/share.ts
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function toBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
      const chars = Math.min(4, Math.ceil((bytes.length - i) * 8 / 6));
      for (let c = 0; c < chars; c++) out += B64[n >> 18 - 6 * c & 63];
    }
    return out;
  }
  function fromBase64(text) {
    const bytes = [];
    let bits = 0;
    let acc = 0;
    for (const ch of text) {
      const v = B64.indexOf(ch);
      if (v < 0) throw new Error("bad brain data in the link");
      acc = acc << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push(acc >> bits & 255);
      }
    }
    return new Uint8Array(bytes);
  }
  function brainToText(genome) {
    const view = new DataView(new ArrayBuffer(genome.length * 8));
    genome.forEach((x, i) => view.setFloat64(i * 8, x, true));
    return toBase64(new Uint8Array(view.buffer));
  }
  function brainFromText(text) {
    const bytes = fromBase64(text);
    if (bytes.length % 8 !== 0) throw new Error("bad brain data in the link");
    const view = new DataView(bytes.buffer);
    return Array.from({ length: bytes.length / 8 }, (_, i) => view.getFloat64(i * 8, true));
  }
  function encodeLink(link) {
    const changed = Object.keys(DEFAULT_RULES).filter((k) => link.rules[k] !== DEFAULT_RULES[k]).map((k) => `${k}:${link.rules[k]}`);
    const parts = [`s=${encodeURIComponent(link.seed)}`];
    if (changed.length) parts.push(`r=${changed.join(",")}`);
    parts.push(`at=${link.steps}`);
    if (link.start) parts.push(`b=${brainToText(link.start)}`);
    return `#${parts.join("&")}`;
  }
  function decodeLink(hash) {
    const params = /* @__PURE__ */ new Map();
    for (const part of hash.replace(/^#/, "").split("&")) {
      const eq = part.indexOf("=");
      if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
    }
    if (!params.has("s")) return null;
    const rules = { ...DEFAULT_RULES };
    for (const pair of (params.get("r") ?? "").split(",")) {
      const [k, v] = pair.split(":");
      if (k in DEFAULT_RULES && v !== void 0 && Number.isFinite(Number(v))) rules[k] = Number(v);
    }
    const steps2 = Math.max(0, Math.floor(Number(params.get("at") ?? 0)) || 0);
    const b = params.get("b");
    return { seed: decodeURIComponent(params.get("s")), rules, steps: steps2, start: b ? brainFromText(b) : null };
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
    foodRim: css("--food-rim"),
    poison: css("--poison"),
    hunter: css("--hunter"),
    accent: css("--accent"),
    text: css("--text"),
    muted: css("--muted"),
    line: css("--line"),
    pos: css("--pos"),
    neg: css("--neg"),
    panel: css("--panel")
  };
  var FONT = '"Recursive", system-ui, sans-serif';
  var stainHue = (hue) => (100 + (hue % 360 + 360) % 360 * (300 / 360)) % 360;
  var hsl = (hue) => `hsl(${stainHue(hue)} 55% 40%)`;
  var stain = (hue, a) => `hsla(${stainHue(hue)}, 60%, 36%, ${a})`;
  var reducedMotion = false;
  try {
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
  }
  var world;
  var speed = 1;
  var selectedId = null;
  var followed = null;
  var runSeed = "42";
  var runStart = null;
  var steps = 0;
  var rebuilding = false;
  var runNote = "";
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
        addFx({ x: c.x, y: c.y, kind: "death", hue: c.hue });
      }
    }
  }
  var fx = [];
  var prevFood = [];
  var plateKey = "";
  var plateSince = 0;
  var trails = /* @__PURE__ */ new Map();
  var effectsOn = () => !reducedMotion && speed !== "max";
  function addFx(e) {
    if (effectsOn()) fx.push({ ...e, born: performance.now() });
  }
  function watchFood(now) {
    const key = `${world.generation}:${world.layout}:${steps === 0 ? 0 : 1}`;
    if (key !== plateKey || prevFood.length !== world.food.length) {
      plateKey = key;
      plateSince = now;
      prevFood = world.food.map((f) => ({ x: f.x, y: f.y }));
      trails.clear();
      fx = fx.filter((e) => e.kind === "death");
      return;
    }
    world.food.forEach((f, i) => {
      const p = prevFood[i];
      if (p.x !== f.x || p.y !== f.y) {
        addFx({ x: p.x, y: p.y, kind: looksPoison(world, f) ? "poison" : "eat", hue: 0 });
        p.x = f.x;
        p.y = f.y;
      }
    });
  }
  var agar = null;
  function agarPlate() {
    if (agar) return agar;
    agar = document.createElement("canvas");
    agar.width = W;
    agar.height = H;
    const g = agar.getContext("2d");
    g.fillStyle = C.field;
    g.fillRect(0, 0, W, H);
    let seed = 12345;
    const rnd = () => (seed = seed * 1103515245 + 12345 & 2147483647) / 2147483647;
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(120,100,40,0.06)" : "rgba(255,255,255,0.10)";
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    v.addColorStop(0, "rgba(120,100,40,0)");
    v.addColorStop(1, "rgba(120,100,40,0.16)");
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    return agar;
  }
  function drawWorld(selected) {
    const ctx = worldCtx;
    const now = performance.now();
    watchFood(now);
    ctx.drawImage(agarPlate(), 0, 0);
    const sweep = (now - plateSince) / 700;
    if (!reducedMotion && sweep < 1 && steps > 0) {
      const x = -200 + sweep * (W + 400);
      const g = ctx.createLinearGradient(x - 160, 0, x + 160, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = "rgba(70,50,30,0.10)";
    for (const m of marks) {
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 6, 4.5, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const pulse = !reducedMotion && speed !== "max";
    world.food.forEach((f, i) => {
      if (f.readyAt > world.tick) return;
      if (looksPoison(world, f)) {
        ctx.fillStyle = C.poison;
        for (const [dx, dy, r2] of [[-1.6, -0.8, 1.7], [1.5, -1.1, 1.4], [0.1, 1.6, 1.6]]) {
          ctx.beginPath();
          ctx.arc(f.x + dx, f.y + dy, r2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      const r = 3.3 + (pulse ? 0.35 * Math.sin(now / 650 + i * 1.7) : 0);
      ctx.fillStyle = C.food;
      ctx.strokeStyle = C.foodRim;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    fx = fx.filter((e) => now - e.born < 800);
    for (const e of fx) {
      const t = (now - e.born) / (e.kind === "death" ? 800 : 450);
      if (t >= 1) continue;
      if (e.kind === "death") {
        ctx.fillStyle = stain(e.hue, 0.55 * (1 - t));
        for (let k = 0; k < 6; k++) {
          const ang = k * Math.PI / 3 + 0.4;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(ang) * (3 + 10 * t), e.y + Math.sin(ang) * (3 + 10 * t), 1.8 * (1 - t) + 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = e.kind === "eat" ? C.foodRim : C.poison;
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 3 + 10 * t, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (effectsOn()) {
      for (const c of world.creatures) {
        if (!c.alive) continue;
        let t = trails.get(c.id);
        if (!t) trails.set(c.id, t = []);
        const last = t[t.length - 1];
        if (!last || last.x !== c.x || last.y !== c.y) {
          if (last && (Math.abs(last.x - c.x) > 40 || Math.abs(last.y - c.y) > 40)) t.length = 0;
          t.push({ x: c.x, y: c.y });
          if (t.length > 14) t.shift();
        }
        if (t.length < 2) continue;
        ctx.strokeStyle = stain(c.hue, 0.13);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        t.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
      }
    } else trails.clear();
    for (const c of world.creatures) {
      if (!c.alive) continue;
      const swim = ((c.out[1] ?? 0) + 1) / 2;
      const a = 0.35 + Math.min(c.energy, 1) * 0.55;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.strokeStyle = stain(c.hue, a * 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const phase = pulse ? now / 1e3 * (5 + swim * 14) + c.id : 0;
      for (let j = 0; j <= 8; j++) {
        const x = -6.5 - j * 1.5;
        const y = Math.sin(phase - j * 0.9) * (0.6 + swim * 1.6) * (j / 8);
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = stain(c.hue, a * 0.55);
      ctx.strokeStyle = stain(c.hue, Math.min(1, a + 0.25));
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 7.5, 4.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = stain(c.hue, Math.min(1, a + 0.35));
      ctx.beginPath();
      ctx.arc(1.8, 0, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    world.hunters.forEach((h, idx) => {
      const n = 10;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const ang = k / n * Math.PI * 2;
        const r = 10.5 + (pulse ? 1.3 * Math.sin(now / 700 + k * 1.37 + idx * 2.3) + 0.8 * Math.sin(now / 430 + k * 3.11 + idx) : 0);
        pts.push([h.x + Math.cos(ang) * r, h.y + Math.sin(ang) * r]);
      }
      const mid = (i) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
      ctx.beginPath();
      const m0 = mid(n - 1);
      ctx.moveTo(m0[0], m0[1]);
      for (let k = 0; k < n; k++) {
        const m = mid(k);
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]);
      }
      ctx.closePath();
      ctx.fillStyle = C.hunter;
      ctx.globalAlpha = h.rest > 0 ? 0.25 : 0.5;
      ctx.fill();
      ctx.globalAlpha = h.rest > 0 ? 0.5 : 0.9;
      ctx.strokeStyle = C.hunter;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = C.hunter;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    if (world.rules.walls) {
      ctx.strokeStyle = "rgba(30,43,48,0.35)";
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W - 4, H - 4);
    }
    if (selected && selected.alive) {
      drawSightLines(selected);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, 14, 0, Math.PI * 2);
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
    if (foods[0]) line(foods[0].dx, foods[0].dy, C.foodRim, []);
    if (r.senseFood2 && foods[1]) line(foods[1].dx, foods[1].dy, C.foodRim, [6, 5]);
    if (scan.poison) line(scan.poison.dx, scan.poison.dy, C.poison, [6, 5]);
    if (r.senseCreature) {
      const n = nearest(world.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
      if (n) line(n.dx, n.dy, hsl(n.item.hue), [2, 4]);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  function drawChart() {
    $("chartTitle").textContent = inEcosystem(world) ? "Population over time" : `Food eaten${world.rules.layouts > 1 ? " per map" : ""}, each generation`;
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
    const crownText = lastCrown ? ` Latest champion: family ${lastCrown.fam + 1}, generation ${lastCrown.gen}.` : "";
    const trials = [...world.branches.values()];
    const proof = world.rules.splitProof;
    const trialText = proof > 0 ? ` Branches on trial: ${trials.length}` + (trials.length ? ` (best ${Math.max(...trials.map((b) => b.wins))} of ${proof} wins)` : "") + `, ${world.failedBranches} failed.` : "";
    $("familyText").textContent = `${sorted.length} alive, the biggest ${Math.round(lead[1] / living.length * 100)}% of the living. ${world.splits} split off this run` + (newest ? ` (newest: family ${newest.id + 1}, from ${newest.parent + 1}).` : ".") + (inEcosystem(world) ? "" : trialText + newcomerText() + crownText);
  }
  function newcomerText() {
    if (!world.rules.newcomers && !world.newcomerCount) return "";
    const prot = [...world.families.values()].filter((f) => f.newcomer && world.generation < f.protectedUntil);
    const list = prot.map((f) => `family ${f.id + 1} (${f.protectedUntil - world.generation} more)`).join(", ");
    return ` Newcomers: ${world.newcomerCount}` + (prot.length ? ` (protected: ${list}).` : ".");
  }
  var legacyShown = -1;
  function drawLegacy() {
    if (world.legacy.length === legacyShown) return;
    legacyShown = world.legacy.length;
    const list = $("legacy");
    list.innerHTML = "";
    for (const f of world.legacy.slice(-6).reverse()) {
      const li = document.createElement("li");
      const from = f.parent === null ? "founder" : f.newcomer ? `newcomer from ${f.parent + 1}` : `from ${f.parent + 1}`;
      const champs = f.champions.length ? `, ${f.champions.length} champion${f.champions.length > 1 ? "s" : ""}` : "";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = hsl(founderHue(f.id));
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = `Family ${f.id + 1}, ${from}` + (inEcosystem(world) ? "" : `: average ${mean(f.avgHist).toFixed(1)}, best ${food(f.bestEaten)}${champs}`);
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = `${f.bornInTicks ? "tick" : "gen"} ${f.bornGeneration} to ${f.diedGeneration}, peak ${f.peakSize}`;
      li.append(dot, what, when);
      list.append(li);
    }
    $("legacyText").textContent = world.legacy.length ? `${world.legacy.length} died out this run; newest first.` : "No family has died out yet.";
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
      for (let i = 0; i < nIn; i++) edge(layers[0][i], layers[1][hI], c.w[k++]);
      k++;
    }
    for (let o = 0; o < OUT; o++) {
      for (let hI = 0; hI < nHid; hI++) edge(layers[1][hI], layers[2][o], c.w[k++]);
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
      return `${who2}. Family ${c.family + 1}${fromE}, age ${c.age}, ${c.depth} generation${c.depth === 1 ? "" : "s"} from its founder, ${c.children} child${c.children === 1 ? "" : "ren"}, ate ${c.eaten}` + (world.rules.poison > 0 ? ` (and ${c.poisoned} poison)` : "") + `, energy ${c.energy.toFixed(2)}.` + (world.rules.learnRate > 0 ? ` Learned during life: ${c.learned.toFixed(2)} total weight change.` : "");
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
    const learnedText = world.rules.learnRate > 0 ? ` Learned during life: ${c.learned.toFixed(2)} total weight change.` : "";
    return `${who}. Family ${c.family + 1}${origin}, ${ate}${poisoned}, ${state}.${trial}${streak}${champ}${learnedText}`;
  }
  function draw() {
    updateMarks();
    let sel = world.creatures.find((c) => c.id === selectedId) ?? null;
    const picked = sel !== null;
    if (!sel) {
      sel = inEcosystem(world) ? world.creatures.reduce((a, c) => !a || c.age > a.age ? c : a, null) : world.creatures.find((c) => c.elite) ?? null;
    }
    followed = sel;
    drawWorld(sel);
    drawChart();
    drawFamilies();
    drawLegacy();
    drawBrain(sel);
    $("brainText").textContent = brainCaption(sel, picked);
    $("brainTitle").textContent = sel ? "Brain, live" : "Brain";
    if (inEcosystem(world)) {
      const e = world.eco;
      setGen(`Tick ${world.tick}`, -1);
      setStats([[String(world.creatures.length), "alive now"], [String(e.births), "born"], [String(e.deaths), "died"]]);
      $("tickText").textContent = `${e.oldAge} died of old age.` + (e.rescues ? ` Everyone died ${e.rescues} time${e.rescues === 1 ? "" : "s"}; fresh founders were put in.` : "");
      return;
    }
    const alive = world.creatures.filter((c) => c.alive).length;
    const many = world.rules.layouts > 1;
    setGen(world.rules.mode === 1 ? `Warm-up ${world.generation} of ${world.rules.ecoWarmup}` : `Generation ${world.generation}`, world.generation);
    const last = world.avgHist.length > 0;
    setStats([
      [`${alive}/${world.rules.pop}`, "alive now"],
      [last ? world.avgHist.at(-1).toFixed(1) : "-", "average food, last gen"],
      [last ? food(world.bestHist.at(-1)) : "-", "best, last gen"]
    ]);
    const mapText = many ? `Food map ${world.layout + 1} of ${world.rules.layouts}, tick ${world.tick} of ${world.rules.genTicks}.` : `Tick ${world.tick} of ${world.rules.genTicks}.`;
    const poisonText = last && world.rules.poison > 0 ? ` Poison eaten last generation: ${world.poisonHist.at(-1).toFixed(1)} each.` : "";
    const caughtText = world.caughtHist.length ? ` Caught by hunters: ${Math.round(100 * world.caughtHist.at(-1))}% per map.` : "";
    const hb = world.hunterBrains;
    const brainText = hb.length && world.hunters.length ? ` Hunter brains: ${hb.filter((b) => b.origin === "borrowed").length} of ${hb.length} descend from a family that died out.` : world.rules.hunters > 0 && !world.hunters.length ? ` Hunters arrive in generation ${world.rules.hunterFrom}.` : "";
    const swapText = world.swapped ? " On this map the dark granules are the food and the pale beads the poison." : "";
    const note = runNote && world.generation === 1 ? `${runNote} ` : "";
    $("tickText").textContent = `${note}${mapText}${poisonText}${caughtText}${brainText}${swapText}`;
  }
  var shownGen = -2;
  function setGen(text, gen) {
    const el = $("genText");
    if (el.textContent !== text) el.textContent = text;
    if (gen !== shownGen) {
      shownGen = gen;
      if (!reducedMotion && speed !== "max") {
        el.classList.remove("turn");
        void el.offsetWidth;
        el.classList.add("turn");
      }
    }
  }
  var statsShown = "";
  function setStats(items) {
    const key = JSON.stringify(items);
    if (key === statsShown) return;
    statsShown = key;
    const box = $("stats");
    box.innerHTML = "";
    for (const [value, label] of items) {
      const d = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = value;
      const span = document.createElement("span");
      span.textContent = label;
      d.append(b, span);
      box.append(d);
    }
  }
  function advance() {
    step(world);
    steps++;
  }
  function frame() {
    if (rebuilding) {
    } else if (speed === "max") {
      const end = performance.now() + 12;
      do
        advance();
      while (performance.now() < end);
    } else {
      for (let i = 0; i < speed; i++) advance();
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
    if (e.key === "r" || e.key === "R") openRules();
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
    ["learnRate", "Learning during life", 0, 0.05, 1e-3, "Food strengthens connections that were just active, poison weakens them. 0 = brains fixed for life."],
    ["inheritLearned", "Share of learning children inherit", 0, 1, 0.05, "0.75 = children start with 75% of what the parent learned."],
    ["thinkCost", "Energy cost of thinking", 0, 5e-3, 5e-4, "Per tick, for a brain firing at full strength."],
    ["learnCost", "Energy cost of learning", 0, 0.1, 5e-3, "Per unit of brain change."],
    ["forget", "Forgetting", 0, 0.01, 5e-4, "Share of learned change fading back to the inborn brain each tick. 0 = never forget."],
    ["relativeReward", "Reward vs usual intake", 0, 1, 1, "1 = a meal counts only as better or worse than usual. 0 = food +1, poison -1."],
    ["energyGate", "Learn less when hungry", 0, 1, 1, "1 = learning scales with current energy."],
    ["plasticity", "Evolve how each connection learns", 0, 1, 1, "1 = every connection gets its own learning rate, evolved in the genome (doubles it). Needs learning on."],
    ["hunters", "Hunters", 0, 20, 1, "Dark amoebae that hunt creatures (top speed 2; creatures up to 3). A caught creature is out for the rest of the food map."],
    ["hunterSense", "Creatures sense the nearest hunter", 0, 1, 1, "Adds 3 inputs to the brain when there are hunters."],
    ["hunterBrains", "Hunters evolve brains", 0, 1, 1, "Off = hunters chase the nearest creature. On = each hunter has a brain shaped like a creature's (its 'food' sense points at creatures) and the best catchers breed."],
    ["hunterPool", "Hunter brains in the gene pool", 1, 40, 1, "With brains: more brains are kept than hunt at once; each food map uses the next ones in turn. Fewer than the hunters = the hunters."],
    ["hunterHunger", "Hunter hunger per tick", 5e-4, 5e-3, 5e-4, "Ecosystem mode: energy a hunter loses each tick. Hunters there must eat or die. Tuned with 120 food."],
    ["hunterMeal", "Hunter energy per catch", 0.1, 1, 0.05, "Ecosystem mode. A hunter holds at most 1.5."],
    ["hunterBirth", "Hunter energy for a baby", 0.6, 1.5, 0.05, "Ecosystem mode: a hunter this full splits off a baby with half its energy."],
    ["hunterAge", "Hunters die of old age at", 1e3, 2e4, 500, "Ecosystem mode, in ticks."],
    ["hunterMature", "Hunters can have babies from age", 0, 5e3, 100, "Ecosystem mode, in ticks: young hunters can't have babies."],
    ["hunterBirthChance", "Hunter baby chance per tick", 1e-3, 0.1, 1e-3, "Ecosystem mode: for a full adult hunter just grown up; it falls to 0 at old age (older = harder)."],
    ["hunterFrom", "Hunters arrive in generation", 1, 50, 1, "With brains, half of the first hunters reuse the brains of families that died out, so give the creatures about 10 generations first."],
    ["swapKinds", "Food and poison swap looks", 0, 1, 1, "1 = on each food map a coin flip decides which look is poison. Born brains can't know; learning can. Try poison 0.5."],
    ["mutationRate", "Share of weights each child changes", 0.05, 1, 0.05, "1 = every weight a little. Lower = only a few weights (sparse)."],
    ["centreShare", "Children from the centre brain", 0, 1, 0.1, "Evolution Strategies: a weighted average of the best family's top parents."],
    ["newcomers", "Newcomer families per generation", 0, 5, 1, "A good brain mutated very hard, starting its own family."],
    ["newcomerMutation", "How hard newcomers are mutated", 0, 3, 0.05, "Mutation strength for newcomers only."],
    ["protectGens", "Newcomers protected for N generations", 0, 10, 1, "Its best keeps a seat and has a child, whatever its rank."],
    ["poison", "Share of food that is poison", 0, 0.5, 0.05, "Purple rings. Cost 0.5 energy, worth nothing. Adds a poison sense."],
    ["poisonDose", "Poison dose per pellet", 0, 3, 0.1, "Ecosystem mode: poison raises a level that makes everything cost more energy and slows you down; it fades, and hunters take it on from the prey they catch. The young and old take more. 0 = harmless."],
    ["poisonHalfLife", "Poison fades by half in", 50, 3e3, 50, "Ecosystem mode, in ticks."],
    ["poisonFrail", "Poison resistance of newborns and the old", 0.05, 1, 0.05, "Ecosystem mode: 0.25 = they take 4x the dose; 1 = age doesn't matter."],
    ["resistTrain", "Poison resistance gained per pellet", 0, 0.5, 0.01, "Ecosystem mode: eating poison slowly builds resistance (less harm, same poison carried, so hunters still get it all). Fades without poison; babies get part of it; costs upkeep. 0 = none."],
    ["hunterResistTrain", "Hunter resistance per poisoned catch", 0, 0.5, 5e-3, "Ecosystem mode: hunters build resistance too, more slowly. 0 = none."],
    ["hunterSpit", "Hunters spit out poisoned prey", 0, 1, 1, "Ecosystem mode: a bitten prey that carries poison may be spat out (more poison, more likely). It lives, wounded; the hunter gets a taste and no meal. Makes carrying poison a real defence."],
    ["hunterLearn", "Hunters learn during life", 0, 0.05, 1e-3, "Ecosystem mode: taste aversion. A clean catch strengthens what led to it; a poisoned one weakens it, so a hunter can learn to leave slow (maybe sick) prey alone. 0 = off."],
    ["hunterSeeSpeed", "Hunters see how fast prey move", 0, 1, 1, "Ecosystem mode: poison slows prey, so a slow prey may be sick (or old). Hunters see the nearest prey's speed and evolve what to do with it. Off = blind (a control)."],
    ["foodSpread", "Food spreads like plants", 0, 0.01, 5e-4, "Ecosystem mode: each pellet sprouts new ones nearby, so food left alone multiplies (up to 3x; poison too, up to 3x its start); an eaten one regrows in place. 0 = off."],
    ["regrow", "Food regrows after N ticks", 0, 600, 20, "0 = an eaten pellet reappears somewhere else at once."],
    ["energyCost", "Energy cost of living and moving", 0.5, 3, 0.1, "x normal. Higher = harsher."],
    ["senseFood2", "Sense the second-nearest food", 0, 1, 1, "Adds 3 inputs to the brain."],
    ["senseCreature", "Sense the nearest creature", 0, 1, 1, "Adds 3 inputs to the brain."],
    ["walls", "Walls instead of wrapping around", 0, 1, 1, "Adds a 'wall ahead' sense."]
  ];
  var RULE_GROUPS = [
    ["Population and time", ["pop", "genTicks", "layouts"]],
    ["Food", ["food", "poison", "poisonDose", "poisonHalfLife", "poisonFrail", "hunterSeeSpeed", "hunterSpit", "hunterLearn", "resistTrain", "hunterResistTrain", "regrow", "foodSpread", "energyCost", "swapKinds"]],
    ["Senses and brain", ["senseFood2", "senseCreature", "walls", "hidden"]],
    ["Evolution", ["mutation", "mutationRate", "parents", "elite", "centreShare", "newcomers", "newcomerMutation", "protectGens"]],
    ["Families", ["splitDistance", "splitProof", "championStreak"]],
    ["Hunters", ["hunters", "hunterSense", "hunterBrains", "hunterPool", "hunterFrom", "hunterHunger", "hunterMeal", "hunterBirth", "hunterAge", "hunterMature", "hunterBirthChance"]],
    ["Learning during life", ["learnRate", "inheritLearned", "thinkCost", "learnCost", "forget", "relativeReward", "energyGate", "plasticity"]],
    ["Ecosystem mode", ["mode", "birth", "birthEnergy", "ageScale", "ecoWarmup"]]
  ];
  function renderRules() {
    const root = $("rules");
    root.innerHTML = "";
    const specs = new Map(RULE_SPECS.map((sp) => [sp[0], sp]));
    const grouped = new Set(RULE_GROUPS.flatMap(([, keys]) => keys));
    const other = RULE_SPECS.map((sp) => sp[0]).filter((k) => !grouped.has(k));
    for (const [title, keys] of other.length ? [...RULE_GROUPS, ["Other", other]] : RULE_GROUPS) {
      const h = document.createElement("h3");
      h.textContent = title;
      root.append(h);
      for (const k of keys) {
        const sp = specs.get(k);
        if (sp) root.append(ruleRow(sp));
      }
    }
    updatePending();
  }
  function ruleRow([key, label, min, max, stepV, help]) {
    {
      const id = `rule-${key}`;
      const div = document.createElement("div");
      div.className = "rule";
      div.dataset.key = key;
      if (max === 1 && stepV === 1) {
        div.classList.add("toggle");
        div.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" role="switch" ${pendingRules[key] ? "checked" : ""}> ${label}</label>
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
        return div;
      }
      div.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${stepV}" value="${pendingRules[key]}">
      ${help ? `<small>${help}</small>` : ""}`;
      const input = div.querySelector("input");
      const out = div.querySelector("output");
      const show = () => out.textContent = ["mutation", "splitDistance", "newcomerMutation", "mutationRate", "centreShare", "poison", "energyCost", "birthEnergy", "inheritLearned"].includes(key) ? Number(input.value).toFixed(2) : ["learnRate", "learnCost", "thinkCost", "forget"].includes(key) ? Number(input.value).toFixed(4) : input.value;
      input.oninput = () => {
        pendingRules[key] = Number(input.value);
        show();
        updatePending();
      };
      show();
      return div;
    }
  }
  function updatePending() {
    if (!world) return;
    const changed = Object.keys(pendingRules).filter((k) => pendingRules[k] !== world.rules[k]);
    for (const row of document.querySelectorAll("#rules .rule")) {
      row.classList.toggle("changed", changed.includes(row.dataset.key));
    }
    $("rulesCount").textContent = changed.length ? String(changed.length) : "";
    $("pending").classList.toggle("waiting", changed.length > 0);
    $("pending").textContent = changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"} waiting for the next run.` : "Same rules as the run on the dish.";
  }
  var rulesDialog = $("rulesDialog");
  function openRules() {
    if (!rulesDialog.open) rulesDialog.showModal();
  }
  $("openRules").onclick = openRules;
  $("closeRules").onclick = () => rulesDialog.close();
  rulesDialog.addEventListener("click", (e) => {
    if (e.target === rulesDialog) rulesDialog.close();
  });
  $("applyRules").onclick = () => {
    startRun($("seed").value, pendingRules);
    updatePending();
    rulesDialog.close();
  };
  $("resetRules").onclick = () => {
    Object.assign(pendingRules, DEFAULT_RULES);
    renderRules();
  };
  function startRun(seedText, rules, start) {
    world = createWorld(seedFrom(seedText), rules, start);
    runSeed = seedText;
    runStart = start ? start.slice() : null;
    steps = 0;
    if (location.hash && !rebuilding) history.replaceState(null, "", location.pathname + location.search);
    $("linkText").textContent = "";
    $("linkBox").hidden = true;
    runNote = "";
    selectedId = null;
    legacyShown = -1;
  }
  var fame = [];
  var fameStored = true;
  function fameMessage(text) {
    $("fameText").textContent = text;
  }
  function renderFame() {
    const list = $("fame");
    list.innerHTML = "";
    for (const e of fame) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = hsl(e.hue);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = e.name;
      name.title = `Seed ${e.seed}, saved ${e.savedAt.slice(0, 10)}`;
      const watch = document.createElement("button");
      watch.textContent = "Watch";
      watch.onclick = () => watchSaved(e);
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.onclick = () => {
        fame = fame.filter((x) => x.id !== e.id);
        fameStored = storeFame(fame);
        renderFame();
      };
      li.append(dot, name, watch, del);
      list.append(li);
    }
    if (!fame.length) fameMessage("No saved brains yet. Follow a creature (click it) and save its brain.");
    else if (!fameStored) fameMessage("This browser won't keep them after the page closes: use Export to keep them.");
    else fameMessage(`${fame.length} saved (at most ${FAME_LIMIT}). Kept in this browser; Export to keep them safe.`);
  }
  function watchSaved(e) {
    try {
      startRun(e.seed, e.rules, e.genome);
    } catch (err) {
      fameMessage(`Can't start from this brain: ${err.message}`);
      return;
    }
    Object.assign(pendingRules, e.rules);
    renderRules();
    updatePending();
    $("seed").value = e.seed;
    runNote = `Started from a saved brain: ${e.name}. Everyone begins with it.`;
  }
  $("saveBrain").onclick = () => {
    const c = followed;
    if (!c) {
      fameMessage("Click a creature first (there is no champion to follow until generation 2).");
      return;
    }
    const per = inEcosystem(world) ? 1 : Math.max(1, world.layout + 1);
    const eaten = c.eaten / per;
    const entry = {
      id: `${Date.now().toString(36)}-${c.id}`,
      name: `Gen ${world.generation}, family ${c.family + 1}, ${food(Math.round(eaten * 10) / 10)} food so far`,
      savedAt: (/* @__PURE__ */ new Date()).toISOString(),
      seed: runSeed,
      generation: world.generation,
      eaten,
      hue: c.hue,
      rules: { ...world.rules },
      genome: c.g.slice()
    };
    fame = mergeFame([entry], fame);
    fameStored = storeFame(fame);
    renderFame();
  };
  $("exportFame").onclick = () => {
    const blob = new Blob([JSON.stringify(fame, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "instinct-lab-hall-of-fame.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  };
  $("importFameBtn").onclick = () => $("importFame").click();
  $("importFame").onchange = async (ev) => {
    const input = ev.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const got = parseFame(await file.text());
      fame = mergeFame(fame, got);
      fameStored = storeFame(fame);
      renderFame();
      fameMessage(`Imported ${got.length} brain(s). ${$("fameText").textContent}`);
    } catch (err) {
      fameMessage(`Couldn't import that file: ${err.message}`);
    }
  };
  $("newRun").onclick = () => {
    startRun($("seed").value, pendingRules);
    updatePending();
  };
  $("copyLink").onclick = async () => {
    const hash = encodeLink({ seed: runSeed, rules: world.rules, steps, start: runStart });
    history.replaceState(null, "", hash);
    const link = location.href;
    const box = $("linkBox");
    box.value = link;
    box.hidden = false;
    box.select();
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
    }
    const where = inEcosystem(world) ? `tick ${world.tick}` : `generation ${world.generation}, map ${world.layout + 1}, tick ${world.tick}`;
    $("linkText").textContent = `${copied ? "Copied" : "Select and copy"}: opens this run at ${where} (step ${steps}), paused.` + (location.protocol === "file:" ? " It points to this file on this computer." : "");
  };
  var linkProblem = "";
  function openLink() {
    let link;
    try {
      link = decodeLink(location.hash);
    } catch (err) {
      linkProblem = `Couldn't read this link (${err.message}); started a normal run instead.`;
      return false;
    }
    if (!link) return false;
    try {
      startRun(link.seed, link.rules, link.start ?? void 0);
    } catch (err) {
      rebuilding = false;
      linkProblem = `Couldn't rebuild this run (${err.message}); started a normal run instead.`;
      return false;
    }
    $("seed").value = link.seed;
    Object.assign(pendingRules, link.rules);
    setSpeed(0);
    rebuilding = true;
    const target = link.steps;
    const slice = () => {
      const end = performance.now() + 40;
      while (steps < target && performance.now() < end) advance();
      $("linkText").textContent = steps < target ? `Rebuilding the run from the link: step ${steps} of ${target} (generation ${world.generation})...` : `Rebuilt from a link: the exact same run at step ${target}, paused. Press 1\xD7 to carry on.`;
      if (steps < target) setTimeout(slice, 0);
      else rebuilding = false;
    };
    slice();
    return true;
  }
  if (!openLink()) {
    startRun("42", DEFAULT_RULES);
    $("linkText").textContent = linkProblem;
  }
  ({ list: fame, stored: fameStored } = loadFame());
  renderFame();
  renderRules();
  if (!rebuilding) setSpeed(1);
  frame();
  window.lab = { world: () => world, steps: () => steps };
})();

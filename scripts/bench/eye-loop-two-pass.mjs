// The same loop in JavaScript with flat arrays (the best case for JS): same data, same sums, same order as eye.c.
const C = 62, F = 234, HN = 12, T = 15000;
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / 16777216; };
const fx = new Float64Array(F), fy = new Float64Array(F), st = new Uint8Array(F), cx = new Float64Array(C), cy = new Float64Array(C), ch = new Float64Array(C), sh = new Float64Array(C), hx = new Float64Array(HN), hy = new Float64Array(HN), hs = new Float64Array(HN);
for (let i = 0; i < F; i++) { fx[i] = rnd() * 800; fy[i] = rnd() * 600; const u = rnd(); st[i] = u < 0.2 ? 0 : u < 0.44 ? 2 : 1; }
for (let i = 0; i < C; i++) { cx[i] = rnd() * 800; cy[i] = rnd() * 600; ch[i] = rnd() * 2 - 1; sh[i] = rnd() * 2 - 1; }
for (let i = 0; i < HN; i++) { hx[i] = rnd() * 800; hy[i] = rnd() * 600; hs[i] = rnd() * 2; }
const W = 800, H = 600, halfW = 400, halfH = 300, R = 200, R2 = 40000;
const inp = new Float64Array(20), DX = new Float64Array(F), DY = new Float64Array(F), D2 = new Float64Array(F); let sum = 0, checks = 0;
const t0 = performance.now();
for (let t = 0; t < T; t++) {
  for (let c = 0; c < C; c++) {
    const x = cx[c], y = cy[c], cosH = ch[c], sinH = sh[c];
    for (let k = 0; k < 20; k++) inp[k] = 0;
    for (let i = 0; i < F; i++) {
      let dx = fx[i] - x; dx = dx > halfW ? dx - W : dx < -halfW ? dx + W : dx;
      let dy = fy[i] - y; dy = dy > halfH ? dy - H : dy < -halfH ? dy + H : dy;
      DX[i] = dx; DY[i] = dy; D2[i] = dx * dx + dy * dy;
    }
    for (let i = 0; i < F; i++) {
      const s = st[i]; checks++;
      const d2 = D2[i];
      if (s === 0 || d2 >= R2) continue;
      const dx = DX[i], dy = DY[i];
      const v = 1 - d2 / R2, aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
      const q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
      inp[q] += v; if (s === 2) inp[4 + q] += v;
    }
    for (let i = 0; i < C; i++) {
      checks++;
      if (i === c) continue;
      let dx = cx[i] - x; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
      if (dx >= R || dx <= -R) continue;
      let dy = cy[i] - y; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
      const d2 = dx * dx + dy * dy; if (d2 >= R2) continue;
      const aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
      const q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
      inp[8 + q] += 1 - d2 / R2;
    }
    for (let i = 0; i < HN; i++) {
      checks++;
      let dx = hx[i] - x; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
      let dy = hy[i] - y; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
      const d2 = dx * dx + dy * dy; if (d2 >= R2) continue;
      const v = 1 - d2 / R2, aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
      const q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
      const m = hs[i] / 2 < 1 ? hs[i] / 2 : 1;
      inp[12 + q] += v; inp[16 + q] += v * m;
    }
    for (let k = 0; k < 20; k++) sum += inp[k];
    cx[c] = x + 1 >= W ? x + 1 - W : x + 1;
  }
}
const sec = (performance.now() - t0) / 1000, dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, sum);
console.log(`JS two-pass: ${sec.toFixed(2)} s, ${(1e9 * sec / checks).toFixed(2)} ns per check, checks ${checks}, checksum ${dv.getBigUint64(0).toString(16).padStart(16, "0")}`);

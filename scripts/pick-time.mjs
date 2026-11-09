// Pick over time (Rey 2026-11-09): real cue vs control, per time window, paired seeds. Reads the running totals life-genes saves at each mark.
//   node scripts/pick-time.mjs <real> <control>
import { readFileSync } from "node:fs";
const L = (n) => JSON.parse(readFileSync(`proto/out/life-genes/${n}.json`, "utf8"));
const [a, b] = process.argv.slice(2), A = L(a), B = L(b);
const win = (r, mi) => { const x = r.marks[mi].sick, y = mi ? r.marks[mi - 1].sick : [0, 0, 0, 0]; const c = x[0] - y[0], n = x[3] - y[3], sh = x[2] - y[2]; return c > 0 && n > 0 && sh > 0 ? (x[1] - y[1]) / c / (sh / n) : NaN; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a"), avg = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
for (const c of [0, 1]) {
  const ra = A.filter((r) => r.cond === c).sort((x, y) => x.seed - y.seed), rb = B.filter((r) => r.cond === c).sort((x, y) => x.seed - y.seed);
  console.log(`${c ? "evolved" : "handed out"}: ${a} vs ${b}, ${ra.length} seeds`);
  for (let mi = 0; mi < ra[0].marks.length; mi++) {
    const pa = ra.map((r) => win(r, mi)), pb = rb.map((r) => win(r, mi));
    const both = pa.map((x, i) => [x, pb[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    console.log(`  window ${mi + 1}: pick ${f(avg(pa))} vs ${f(avg(pb))}, lower in ${both.filter(([x, y]) => x < y).length} of ${both.length} | hunters ${f(avg(ra.map((r) => r.marks[mi].hunters)))} vs ${f(avg(rb.map((r) => r.marks[mi].hunters)))} (at the window's end)`);
  }
}

// Paired comparison (Rey 2026-11-06): real cue vs its shuffled control, same seeds. Rey's "adapted" bar: pick lower AND hunters alive
// higher in the real run in >= 10 of 14 seeds (per condition). Reads proto/out/life-genes/<name>.json.
//   node scripts/pair.mjs <real> <control>
import { readFileSync } from "node:fs";
const L = (n) => JSON.parse(readFileSync(`proto/out/life-genes/${n}.json`, "utf8"));
const [a, b] = process.argv.slice(2), A = L(a), B = L(b);
const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a"), avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
for (const c of [0, 1]) {
  const ra = A.filter((r) => r.cond === c).sort((x, y) => x.seed - y.seed), rb = B.filter((r) => r.cond === c).sort((x, y) => x.seed - y.seed);
  const n = Math.min(ra.length, rb.length), P = ra.slice(0, n).map((r, i) => [r, rb[i]]);
  if (P.some(([x, y]) => x.seed !== y.seed)) throw new Error("seeds differ");
  const cnt = (fn) => P.filter(([x, y]) => fn(x, y)).length;
  const pickLower = cnt((x, y) => x.m.pick < y.m.pick), huntMore = cnt((x, y) => x.m.hunters > y.m.hunters), both = cnt((x, y) => x.m.pick < y.m.pick && x.m.hunters > y.m.hunters);
  console.log(`${c ? "evolved" : "handed out"}: ${a} vs ${b}, ${n} seeds | pick ${f(avg(P.map(([x]) => x.m.pick)))} vs ${f(avg(P.map(([, y]) => y.m.pick)))}, lower in ${pickLower} of ${n} | hunters ${f(avg(P.map(([x]) => x.m.hunters)))} vs ${f(avg(P.map(([, y]) => y.m.hunters)))}, more in ${huntMore} of ${n} | both in ${both} of ${n} | prey ${f(avg(P.map(([x]) => x.m.prey)))} vs ${f(avg(P.map(([, y]) => y.m.prey)))} | works ${cnt((x) => x.m.works)} vs ${cnt((x, y) => y.m.works)}`);
}

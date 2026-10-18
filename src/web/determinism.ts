// determinism.html: replays the recorded runs in whatever browser opens the page and reports whether
// every number matches. JavaScript lets each engine compute sin, cos, atan2, tanh, log slightly
// differently, so "same seed = same run" has to be checked per browser, not assumed.
import goldenJson from "../../test/golden.json" with { type: "json" };
import { CASES, firstDifference, runCase, type GoldenResult } from "../check/golden.ts";

const golden = goldenJson as unknown as Record<string, GoldenResult | undefined>;
const $ = (id: string) => document.getElementById(id)!;

async function main(): Promise<void> {
  $("agent").textContent = navigator.userAgent;
  const list = $("results");
  let bad = 0;
  for (const c of CASES) {
    const li = document.createElement("li");
    li.textContent = `${c.name}: running ${c.gens} generations...`;
    list.append(li);
    await new Promise((r) => setTimeout(r, 30)); // let the page paint
    const want = golden[c.name];
    if (!want) {
      li.textContent = `${c.name}: not recorded yet`;
      continue;
    }
    const t0 = performance.now();
    const diff = firstDifference(runCase(c), want);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    li.className = diff ? "bad" : "good";
    li.textContent = diff ? `${c.name}: DIFFERENT. ${diff}` : `${c.name}: identical (${secs} s)`;
    if (diff) bad++;
  }
  $("summary").textContent = bad
    ? `${bad} recorded run(s) differ in this browser. Same seed does NOT give the same run here.`
    : "Every recorded run matches exactly in this browser.";
  $("summary").className = bad ? "bad" : "good";
}

void main();

// Rey 2026-11-02 (c): can hunter poison resistance be bred on purpose? Generations mode, 4 brain hunters
// (pool 12) with an inborn resistance gene (founders 0, children = parent + mutation). A judge ranks hunters by
// net meals per map: catches - poison (every prey carries genPreyToxin) - upkeep. Side arena (toxin 1) vs control
// (toxin 0, the gene only costs upkeep). Break-even at toxin L: r > 1 - 1/(3.6 L) (0.72 at L = 1).
//   node src/cli/resist-breed.ts [--gens=130] [--seeds=1-1] [--toxin=1] [--slow=0] (slow: top speed x (1 - slow x gene))
import { createWorld, runGenerations, DEFAULT_RULES, type Rules } from "../engine/world.ts";

const opt = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const GENS = Number(opt("gens", "130")), TOX = Number(opt("toxin", "1")), SLOW = Number(opt("slow", "0"));
const [s0, s1] = opt("seeds", "1-1").split("-").map(Number);
const MARKS = [1, 10, 30, 60, 100, 130, GENS].filter((g, i, a) => g <= GENS && a.indexOf(g) === i);
const BASE: Partial<Rules> = { hunters: 4, hunterBrains: 1, hunterFrom: 1, hunterResistGene: 1, hunterResistSlow: SLOW };
console.log(`Breeding resistance: generations mode, speed cost ${SLOW} x gene, ${GENS} gens, seeds ${s0}-${s1 ?? s0}; break-even r > ${(1 - 1 / (3.6 * TOX)).toFixed(2)} at toxin ${TOX}`);
for (const [name, tox] of [[`side arena (toxin ${TOX})`, TOX], ["control (toxin 0)", 0]] as [string, number][]) {
  const rows: string[] = [];
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const w = createWorld(seed, { ...DEFAULT_RULES, ...BASE, genPreyToxin: tox } as Rules);
    runGenerations(w, GENS);
    rows.push(MARKS.map((g) => { const h = w.hunterHist[g - 1]; return `${g}: r ${(h?.resist ?? NaN).toFixed(2)} catch ${(h?.avg ?? NaN).toFixed(1)}`; }).join(" | "));
  }
  console.log(`${name}\n  ${rows.join("\n  ")}`);
}

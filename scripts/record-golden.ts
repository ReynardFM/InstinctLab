// Re-records every case in test/golden.json. Only for changes that are MEANT to alter behaviour.
// npm run record-golden
import { writeFileSync } from "node:fs";
import { CASES, runCase } from "../src/check/golden.ts";

const golden: Record<string, unknown> = {};
for (const c of CASES) {
  golden[c.name] = runCase(c);
  console.log(`recorded ${c.name} (${c.gens} generations)`);
}
writeFileSync(new URL("../test/golden.json", import.meta.url), JSON.stringify(golden));
console.log("Commit test/golden.json and say in the message why behaviour changed.");

// Re-records the "defaults" entry of test/golden.json. Only for changes that are MEANT to alter behaviour.
// npm run record-defaults
import { readFileSync, writeFileSync } from "node:fs";
import { CASES, runCase } from "../src/check/golden.ts";

const file = new URL("../test/golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(file, "utf8"));
const c = CASES.find((x) => x.name === "defaults")!;
golden.defaults = runCase(c);
writeFileSync(file, JSON.stringify(golden));
console.log(`Recorded "defaults": ${c.gens} generations, averages ${golden.defaults.avg.map((v: number) => v.toFixed(2)).join(", ")}`);
console.log("Commit test/golden.json and say in the message why behaviour changed.");

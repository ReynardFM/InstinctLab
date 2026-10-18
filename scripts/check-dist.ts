// Fails if dist/ is out of date with src/: rebuilds in memory with the same settings as `npm run build`
// and compares byte for byte. Part of `npm run check`.
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { BUNDLES } from "./bundles.ts";

let stale = 0;
for (const { entry, out } of BUNDLES) {
  const built = buildSync({ entryPoints: [entry], bundle: true, format: "iife", target: "es2022", write: false, outfile: out });
  const fresh = built.outputFiles[0].text;
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {
    // missing counts as stale
  }
  if (fresh !== current) {
    console.log(`STALE: ${out} does not match ${entry}. Run npm run build and commit ${out}.`);
    stale++;
  } else console.log(`ok: ${out}`);
}
if (stale) process.exit(1);

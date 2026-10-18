// Builds the browser bundles in dist/. npm run build (add --watch to rebuild on save).
import { build, context } from "esbuild";
import { BUNDLES } from "./bundles.ts";

const watch = process.argv.includes("--watch");
for (const { entry, out } of BUNDLES) {
  const options = { entryPoints: [entry], bundle: true, format: "iife" as const, target: "es2022", outfile: out, logLevel: "info" as const };
  if (watch) await (await context(options)).watch();
  else await build(options);
}

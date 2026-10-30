// Builds proto/play.html: the learning-game prototype as ONE self-contained file (opens by double-click,
// the evolution worker is inlined as a Blob). npm run build-play
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const common = { bundle: true, format: "iife" as const, target: "es2022", write: false, logLevel: "warning" as const };
const w = await build({ ...common, entryPoints: ["proto/game/worker.ts"], minify: true });
const m = await build({ ...common, entryPoints: ["proto/play.ts"], define: { __WORKER_SRC__: JSON.stringify(w.outputFiles![0].text) } });
const js = m.outputFiles![0].text.replace(/<\/script/gi, "<\\/script");
// Recursive (OFL, assets/fonts) embedded so the file stays self-contained; the "casual" axis gives the lab-label hand.
const font = readFileSync("assets/fonts/recursive.woff2").toString("base64");
const face = `@font-face { font-family: "Recursive"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 300 1000; font-display: swap; }`;
const html = readFileSync("proto/play.src.html", "utf8").replace("/*FONT*/", () => face).replace("<!--APP-->", () => `<script>\n${js}</script>`);
writeFileSync("proto/play.html", html);
console.log(`proto/play.html ${(html.length / 1024).toFixed(0)} KB`);

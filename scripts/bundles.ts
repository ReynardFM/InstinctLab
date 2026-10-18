// The browser bundles. `npm run build` and scripts/check-dist.ts both use this list.
export const BUNDLES = [
  { entry: "src/web/main.ts", out: "dist/app.js" }, // the lab page (index.html)
  { entry: "src/web/determinism.ts", out: "dist/determinism.js" }, // determinism.html
];

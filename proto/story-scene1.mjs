// Run like proto/story-gifs.mjs: from a folder where ./new is this repo. node scene1.mjs (about 2 min).
// Scene 1 across 14 worlds: the 1-brains.gif procedure (no poison, no hunters, old senses off), seeds 1-14.
// Generation 1 vs generation 60 of the same seed; food eaten in the same 356 ticks of one map (90 frames x 4 ticks).
const e = await import("./new/src/engine/world.ts");
const R = { ...e.DEFAULT_RULES, poison: 0, senseCreature: 0, senseFood2: 0, hunters: 0 };
const eaten = (w) => w.creatures.reduce((a, c) => a + (c.eaten ?? 0), 0);
let more = 0; const rows = [];
for (let s = 1; s <= 14; s++) {
  const a = e.createWorld(s, { ...R }), b = e.createWorld(s, { ...R });
  e.runGenerations(b, 59);
  e.runTicks(a, 356); e.runTicks(b, 356);
  const x = eaten(a), y = eaten(b); if (y > x) more++;
  rows.push(`${s}:${x}->${y}`);
}
console.log(rows.join("  ")); console.log(`gen 60 ate more in ${more} of 14`);

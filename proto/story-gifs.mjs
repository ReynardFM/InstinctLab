// Run outside the repo (2026-11-25): a folder with this file, @napi-rs/canvas from npm, ./new = this repo (src/engine, assets/fonts), ./old = git archive 80fffe7 src/engine (the old re-typing ramp). Frames 30/60/90 of 7-seasons had their season label corrected afterwards (they sit on a season boundary).
// Story GIFs (Rey 2026-11-25: "add the plate in story as gifs instead that proofs the story").
// Draws worlds with the report's glyphs and the design system's brightfield stains, side by side, into PNG frames;
// ffmpeg turns the frames into a GIF. Usage: node gif.mjs <scene> (scenes below).
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

GlobalFonts.registerFromPath(new URL("./new/assets/fonts/recursive.woff2", import.meta.url).pathname, "Recursive");
const FONT = "Recursive, sans-serif";
const C = { paper: "#fbfcf7", agar: "#e7e2b6", ink: "#1e2b30", muted: "#5d6c70", line: "#c9d2cf", accent: "#2b5c9e", control: "#5d6c70",
  food: "#fff8dc", rim: "#b9a24f", poison: "#6e2a5e", prey: "#368658", sick: "#6e2a5e", glow: "#c94a80", hunter: "#34405e", danger: "#b23a48" };

const eng = {};
async function engine(which) {
  if (!eng[which]) {
    const root = new URL(`./${which}/src/engine/`, import.meta.url).pathname;
    eng[which] = { ...(await import(root + "world.ts")), SICK: (await import(root + "toxin.ts")).SICK };
  }
  return eng[which];
}

// The lab's worlds (life-genes WORLD + the testing flags).
const LIFE = { mode: 1, hunters: 4, food: 60, foodSpread: 0.0005, regrow: 100, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1 };
const LAB = { ...LIFE, poison: 0.3, eye: 4, hunterEye: 4, eyeMotion: 1, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1 };
const NOW = { ...LAB, poisonDose: 0.75, hunterDoseCap: 2, resistGene: 0.3, hunterCue: 2 }; // the poison world of plates 7-8
const FAST = { hunterHunger: 0.0025, hunterMeal: 0.5 };

const S = 0.5, DW = 800 * S, DH = 600 * S, RIM = 8, GAP = 28, PAD = 20, TOP = 34, BOT = 46;
function drawWorld(cx, w, x0, y0, glow, SICK) {
  cx.save();
  cx.translate(x0, y0);
  // the dish: glass rim, agar inside (concentric radii)
  cx.fillStyle = "#ffffff"; roundRect(cx, -RIM, -RIM, DW + 2 * RIM, DH + 2 * RIM, 22); cx.fill();
  cx.strokeStyle = "rgba(30,43,48,0.18)"; cx.lineWidth = 1; roundRect(cx, -RIM, -RIM, DW + 2 * RIM, DH + 2 * RIM, 22); cx.stroke();
  cx.save(); roundRect(cx, 0, 0, DW, DH, 14); cx.clip();
  cx.fillStyle = C.agar; cx.fillRect(0, 0, DW, DH);
  cx.scale(S, S);
  for (const f of w.food) {
    if (f.remains || f.readyAt > w.tick) continue;
    if (f.poison) { cx.fillStyle = C.poison; cx.fillRect(f.x - 3.5, f.y - 3.5, 7, 7); }
    else { cx.beginPath(); cx.arc(f.x, f.y, 4, 0, Math.PI * 2); cx.fillStyle = C.food; cx.fill(); cx.strokeStyle = C.rim; cx.lineWidth = 1.6; cx.stroke(); }
  }
  for (const c of w.creatures) {
    if (!c.alive) continue;
    const sick = c.toxin > SICK;
    if (sick && glow) { cx.beginPath(); cx.arc(c.x, c.y, 13, 0, Math.PI * 2); cx.strokeStyle = C.glow; cx.globalAlpha = 0.75; cx.lineWidth = 3.5; cx.stroke(); cx.globalAlpha = 1; }
    cx.beginPath();
    if (sick) { cx.arc(c.x, c.y, 6, 0, Math.PI * 2); cx.strokeStyle = C.sick; cx.lineWidth = 2.4; cx.stroke(); }
    else { cx.arc(c.x, c.y, 7, 0, Math.PI * 2); cx.fillStyle = C.prey; cx.fill(); }
    cx.beginPath(); cx.moveTo(c.x + Math.cos(c.a) * 7, c.y + Math.sin(c.a) * 7); cx.lineTo(c.x + Math.cos(c.a) * 12, c.y + Math.sin(c.a) * 12);
    cx.strokeStyle = sick ? C.sick : C.prey; cx.lineWidth = 2.6; cx.stroke();
  }
  for (const h of w.hunters) {
    const a = h.brain ? h.brain.a : 0;
    cx.save(); cx.translate(h.x, h.y); cx.rotate(a);
    cx.beginPath(); cx.moveTo(14, 0); cx.lineTo(-10, 9); cx.lineTo(-5, 0); cx.lineTo(-10, -9); cx.closePath();
    cx.fillStyle = C.hunter; cx.fill(); cx.restore();
  }
  cx.restore();
  cx.restore();
}
function roundRect(cx, x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
// A specimen tag; the control's tag is hatched (design rule 3).
function tag(cx, x, y, text, ctl) {
  cx.font = `700 12px ${FONT}`;
  const t = text.toUpperCase(), tw = cx.measureText(t).width + 16;
  cx.save(); roundRect(cx, x, y, tw, 20, 4);
  cx.fillStyle = C.paper; cx.fill();
  if (ctl) { cx.clip(); cx.strokeStyle = "rgba(93,108,112,0.35)"; cx.lineWidth = 1.5; for (let i = -20; i < tw + 20; i += 6) { cx.beginPath(); cx.moveTo(x + i, y + 20); cx.lineTo(x + i + 20, y); cx.stroke(); } }
  cx.restore();
  cx.strokeStyle = ctl ? C.control : C.line; cx.lineWidth = 1; roundRect(cx, x, y, tw, 20, 4); cx.stroke();
  cx.fillStyle = C.ink; cx.fillText(t, x + 8, y + 14.5);
}
const num = (x) => Math.round(x).toLocaleString("en-US");

// sides: [{ label, ctl, which, rules, seed, glow, stats(w) }]; start: ticks before the first frame; frames x every ticks.
async function clip(name, { sides, start = 0, frames = 90, every = 8, fps = 15, top, hold = 0, before }) {
  const n = sides.length, Wd = PAD * 2 + n * (DW + 2 * RIM) + (n - 1) * GAP, Ht = TOP + (top ? 26 : 0) + DH + 2 * RIM + BOT;
  const dir = `/home/claude/gif/frames/${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const W = [];
  await engine("new");
  for (const s of sides) { const e = await engine(s.which ?? "new"); const w = e.createWorld(s.seed ?? 1, { ...e.DEFAULT_RULES, ...s.rules }); if (before) before(w, s); if (start) e.runTicks(w, start); W.push({ e, w }); }
  const cv = createCanvas(Wd, Ht), cx = cv.getContext("2d");
  let k = 0;
  for (let f = 0; f < frames + hold; f++) {
    if (f > 0 && f < frames) for (const { e, w } of W) e.runTicks(w, every);
    cx.fillStyle = C.paper; cx.fillRect(0, 0, Wd, Ht);
    let y = 10;
    if (top) { cx.font = `600 15px ${FONT}`; cx.fillStyle = C.ink; cx.fillText(top(W[0].w), PAD, y + 14); y += 26; }
    sides.forEach((s, i) => {
      const x = PAD + RIM + i * (DW + 2 * RIM + GAP);
      tag(cx, x - RIM, y, s.label, s.ctl);
      drawWorld(cx, W[i].w, x, y + 26 + RIM, s.glow ?? false, W[i].e.SICK);
      cx.font = `400 13px ${FONT}`; cx.fillStyle = C.ink;
      const lines = s.stats(W[i].w).split("\n");
      lines.forEach((l, j) => cx.fillText(l, x - RIM, y + 26 + DH + 2 * RIM + 18 + j * 17));
    });
    await writeFile(`${dir}/f${String(k++).padStart(4, "0")}.png`, cv.toBuffer("image/png"));
  }
  const out = `/home/claude/gif/out/${name}.gif`; mkdirSync("/home/claude/gif/out", { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", `${dir}/f%04d.png`, "-vf",
    `split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=none`, "-loop", "0", out]);
  console.log(name, "done:", out);
}

const alive = (w) => w.creatures.filter((c) => c.alive).length;
const dieOuts = (w) => w.eco.rounds.filter((r) => r.died !== "prey").length;
const share = (w) => { const p = w.food.filter((f) => !f.remains && f.readyAt !== Infinity); return p.length ? p.filter((f) => f.poison).length / p.length : 0; };
const pct = (x) => `${Math.round(x * 100)}%`;
const res = (xs) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "–";
const hRes = (w) => res(w.hunters.map((h) => h.resist ?? 0));
const pRes = (w) => res(w.creatures.filter((c) => c.alive).map((c) => c.resist ?? 0));

const SLOW = { hunterHunger: 0.000625, hunterMeal: 0.125 };
const PROOF = LAB; // the report's PROOF world
const pick = (w) => { const s = w.eco.sick; return s.caught && s.samples && s.sickShare ? (s.caughtSick / s.caught) / (s.sickShare / s.samples) : NaN; };
const sickNow = (w) => { const cs = w.creatures.filter((c) => c.alive); return cs.length ? cs.filter((c) => c.toxin > eng.new.SICK).length / cs.length : 0; };
const eaten = (w) => w.creatures.reduce((a, c) => a + (c.eaten ?? 0), 0);
const per100 = (w) => { const p = alive(w); return p ? Math.round((100 * w.hunters.length) / p) : "–"; };
const SCENES = {
  // 1: evolution alone. Generation 1 vs generation 60 of the same world, same seed, same food map length.
  brains: () => clip("1-brains", { frames: 90, every: 4,
    before: (w, s) => { if (s.gens) eng.new.runGenerations(w, s.gens); },
    sides: [
      { label: "Generation 1 · seed 1", ctl: true, rules: { poison: 0, senseCreature: 0, senseFood2: 0, hunters: 0 }, gens: 0,
        stats: (w) => `generation ${w.generation} · tick ${num(w.tick)}\nfood eaten so far ${num(eaten(w))}` },
      { label: "Generation 60 · seed 1", rules: { poison: 0, senseCreature: 0, senseFood2: 0, hunters: 0 }, gens: 59,
        stats: (w) => `generation ${w.generation} · tick ${num(w.tick)}\nfood eaten so far ${num(eaten(w))}` },
    ] }),
  // 2: the living world: no judge; prey and hunters eat, breed and die on their own.
  hunters: () => clip("2-hunters", { start: 30000, frames: 90, every: 4,
    sides: [{ label: "The living world · seed 1", rules: { ...LIFE, poison: 0, ...FAST },
      stats: (w) => `tick ${num(w.tick)} · prey ${alive(w)} · hunters ${w.hunters.length}\nhunter babies ${num(w.eco.hunterBirths)} · hunter deaths ${num(w.eco.hunterDeaths)}` }] }),
  // 3: glow vs blind hunters (the report's plate 4 world).
  glow: () => clip("3-glow", { start: 40000, frames: 90, every: 6,
    sides: [
      { label: "Blind hunters · seed 1", ctl: true, rules: { ...PROOF, ...FAST, hunterCue: 0 }, glow: false,
        stats: (w) => `prey ${alive(w)} · hunters ${w.hunters.length} · sick now ${pct(sickNow(w))}\npick so far ${pick(w).toFixed(2)} (below 1 = sick prey skipped)` },
      { label: "Glow hunters · seed 1", rules: { ...PROOF, ...FAST, hunterCue: 2 }, glow: true,
        stats: (w) => `prey ${alive(w)} · hunters ${w.hunters.length} · sick now ${pct(sickNow(w))}\npick so far ${pick(w).toFixed(2)} (below 1 = sick prey skipped)` },
    ] }),
  // 4: fast vs slow hunters, a time-lapse of 120,000 ticks.
  slow: () => clip("4-slow", { frames: 100, every: 1200, fps: 12, hold: 15,
    sides: [
      { label: "Fast hunters · seed 1", ctl: true, rules: { ...PROOF, hunterCue: 2, ...FAST }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · hunters ${w.hunters.length} per 100 prey ${per100(w)}\nhunters died out ${dieOuts(w)}×` },
      { label: "Slow hunters · seed 1", rules: { ...PROOF, hunterCue: 2, ...SLOW }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · hunters ${w.hunters.length} per 100 prey ${per100(w)}\nhunters died out ${dieOuts(w)}×` },
    ] }),
  // 5: judged by nature: no poison vs poison, a time-lapse of 400,000 ticks; toughness is the number to watch.
  nature: () => clip("5-nature", { frames: 100, every: 4000, fps: 12, hold: 15,
    sides: [
      { label: "No poison plants · seed 1", ctl: true, rules: { ...NOW, poison: 0 }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · prey ${alive(w)} · hunters ${w.hunters.length}\ntoughness: prey ${pRes(w)} · hunters ${hRes(w)}` },
      { label: "Poison · seed 1", rules: { ...NOW }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · prey ${alive(w)} · hunters ${w.hunters.length}\ntoughness: prey ${pRes(w)} · hunters ${hRes(w)}` },
    ] }),
  // 7: 60% poison held vs 60% as seasons (23 / 60 / 23 / 60%), a time-lapse of 3,000,000 ticks.
  seasons: () => clip("7-seasons", { frames: 120, every: 25000, fps: 12, hold: 15,
    sides: [
      { label: "Poison held at 60% · seed 1", ctl: true, rules: { ...NOW, poisonRamp: 1, poisonPeak: 0.6 }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · poison plants ${pct(share(w))}\nhunters ${w.hunters.length} · hunters died out ${dieOuts(w)}×` },
      { label: "60% as seasons · seed 1", rules: { ...NOW, season: 3000000, poisonRamp: 1, poisonPeak: 0.6 }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · poison plants ${pct(share(w))} (${["normal", "poison", "normal", "poison"][Math.min(3, Math.floor((4 * w.tick) / 3000000))]} season)\nhunters ${w.hunters.length} · hunters died out ${dieOuts(w)}×` },
    ] }),
  // 6: the bug. Same world, same seed, poison rising 23% -> 40% over 300k (the fast rise). Old ramp vs fixed ramp at ~200k.
  bug: () => clip("6-bug", {
    start: 200000, frames: 90, every: 6, fps: 15,
    sides: [
      { label: "Old ramp · seed 1", ctl: true, which: "old", rules: { ...NOW, poisonRamp: 300000, poisonPeak: 0.4 }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · poison plants ${pct(share(w))}\nhunters ${w.hunters.length} · hunters died out ${dieOuts(w)}×` },
      { label: "Fixed ramp · seed 1", which: "new", rules: { ...NOW, poisonRamp: 300000, poisonPeak: 0.4 }, glow: true,
        stats: (w) => `tick ${num(w.tick)} · poison plants ${pct(share(w))}\nhunters ${w.hunters.length} · hunters died out ${dieOuts(w)}×` },
    ],
  }),
};
const which = process.argv[2];
if (!SCENES[which]) { console.log("scenes:", Object.keys(SCENES).join(" ")); process.exit(1); }
const t0 = Date.now(); await SCENES[which](); console.log(`${((Date.now() - t0) / 60000).toFixed(1)} min`);

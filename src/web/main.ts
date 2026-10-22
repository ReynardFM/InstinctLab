// The page: drawing and controls. It reads the World but never changes how it evolves.
import { createWorld, founderHue, step, DEFAULT_RULES, W, H, type Creature, type Family, type Rules, type World } from "../engine/world.ts";
import { OUT } from "../engine/brain.ts";
import { inputLabels, looksPoison, scanFood } from "../engine/senses.ts";
import { ECO_SAMPLE } from "../engine/ecosystem.ts";
import { inEcosystem } from "../engine/mode.ts";
import { nearest } from "../engine/space.ts";
import { seedFrom } from "../engine/rng.ts";
import { FAME_LIMIT, loadFame, mergeFame, parseFame, storeFame, type FameEntry } from "./fame.ts";
import { decodeLink, encodeLink } from "./share.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ctx2d = (id: string) => $<HTMLCanvasElement>(id).getContext("2d")!;
const worldCtx = ctx2d("world");
const chartCtx = ctx2d("chart");
const famCtx = ctx2d("families");
const brainCtx = ctx2d("brain");

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = {
  field: css("--field"), food: css("--food"), foodRim: css("--food-rim"), poison: css("--poison"), hunter: css("--hunter"),
  accent: css("--accent"), text: css("--text"), muted: css("--muted"),
  line: css("--line"), pos: css("--pos"), neg: css("--neg"), panel: css("--panel"),
};
const FONT = '"Recursive", system-ui, sans-serif';
// Family colours are stains: solid in the notebook, translucent on the agar.
// Hues are squeezed out of the yellow band (about 40-100), which vanishes on straw-coloured agar;
// the notebook uses the same mapping, so a family has one colour everywhere.
const stainHue = (hue: number) => (100 + (((hue % 360) + 360) % 360) * (300 / 360)) % 360;
const hsl = (hue: number) => `hsl(${stainHue(hue)} 55% 40%)`;
const stain = (hue: number, a: number) => `hsla(${stainHue(hue)}, 60%, 36%, ${a})`;
let reducedMotion = false;
try {
  reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch {
  // no matchMedia: keep the motion
}

type Speed = 0 | 1 | 10 | "max";
let world: World;
let speed: Speed = 1;
let selectedId: number | null = null;
let followed: Creature | null = null; // the creature the brain panel shows (picked, or the default)
let runSeed = "42";
let runStart: number[] | null = null; // the saved brain this run started from, if any
let steps = 0; // steps since the run started: with seed, rules and start brain, it pins down this exact moment
let rebuilding = false; // fast-forwarding to a link's moment
let runNote = ""; // e.g. "Started from a saved brain: ..."
const pendingRules: Rules = { ...DEFAULT_RULES };

// Where creatures died on this food layout. Page-only memory; the engine doesn't know about it.
interface DeathMark { x: number; y: number; tick: number }
let marks: DeathMark[] = [];
let markedIds = new Set<number>();
let marksKey = "";

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// Food amounts per layout can be fractions (e.g. 22.3); whole numbers stay whole.
const food = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function updateMarks(): void {
  if (inEcosystem(world)) {
    // ecosystem: the dead are removed from the world, so the engine keeps their last spots
    marks = world.eco.recentDeaths;
    return;
  }
  const key = `${world.generation}:${world.layout}`;
  if (key !== marksKey) {
    marks = [];
    markedIds = new Set();
    marksKey = key;
  }
  for (const c of world.creatures) {
    if (!c.alive && !markedIds.has(c.id)) {
      markedIds.add(c.id);
      marks.push({ x: c.x, y: c.y, tick: c.diedAt ?? world.tick });
      addFx({ x: c.x, y: c.y, kind: "death", hue: c.hue });
    }
  }
}

// ---------- moments worth seeing (page only: read from the world, never written to it) ----------
// eat: food that moved since the last frame was eaten where it was; death: a creature newly dead;
// a new food map or generation: the plate is renewed (one soft sweep of light across the dish).
interface Fx { x: number; y: number; kind: "eat" | "poison" | "death"; hue: number; born: number }
let fx: Fx[] = [];
let prevFood: { x: number; y: number }[] = [];
let plateKey = "";
let plateSince = 0;
const trails = new Map<number, { x: number; y: number }[]>();
const effectsOn = () => !reducedMotion && speed !== "max";

function addFx(e: Omit<Fx, "born">): void {
  if (effectsOn()) fx.push({ ...e, born: performance.now() });
}

function watchFood(now: number): void {
  const key = `${world.generation}:${world.layout}:${steps === 0 ? 0 : 1}`;
  if (key !== plateKey || prevFood.length !== world.food.length) {
    plateKey = key;
    plateSince = now;
    prevFood = world.food.map((f) => ({ x: f.x, y: f.y }));
    trails.clear();
    fx = fx.filter((e) => e.kind === "death");
    return;
  }
  world.food.forEach((f, i) => {
    const p = prevFood[i];
    if (p.x !== f.x || p.y !== f.y) {
      addFx({ x: p.x, y: p.y, kind: looksPoison(world, f) ? "poison" : "eat", hue: 0 });
      p.x = f.x;
      p.y = f.y;
    }
  });
}

// The agar: drawn once (pale straw, a little grain, darker towards the rim).
let agar: HTMLCanvasElement | null = null;
function agarPlate(): HTMLCanvasElement {
  if (agar) return agar;
  agar = document.createElement("canvas");
  agar.width = W;
  agar.height = H;
  const g = agar.getContext("2d")!;
  g.fillStyle = C.field;
  g.fillRect(0, 0, W, H);
  let seed = 12345; // a fixed grain, so the plate looks the same every time
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(120,100,40,0.06)" : "rgba(255,255,255,0.10)";
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, "rgba(120,100,40,0)");
  v.addColorStop(1, "rgba(120,100,40,0.16)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return agar;
}

// ---------- world: the culture dish ----------
function drawWorld(selected: Creature | null): void {
  const ctx = worldCtx;
  const now = performance.now();
  watchFood(now);
  ctx.drawImage(agarPlate(), 0, 0);

  // a renewed plate: one soft sweep of light across the dish
  const sweep = (now - plateSince) / 700;
  if (!reducedMotion && sweep < 1 && steps > 0) {
    const x = -200 + sweep * (W + 400);
    const g = ctx.createLinearGradient(x - 160, 0, x + 160, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // where creatures died on this map: faint smudges
  ctx.fillStyle = "rgba(70,50,30,0.10)";
  for (const m of marks) {
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 6, 4.5, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // food: pale yeast beads; poison: dark granules (a different shape, not just a different colour)
  const pulse = !reducedMotion && speed !== "max";
  world.food.forEach((f, i) => {
    if (f.readyAt > world.tick) return; // eaten, not regrown yet
    if (looksPoison(world, f)) {
      ctx.fillStyle = C.poison;
      for (const [dx, dy, r] of [[-1.6, -0.8, 1.7], [1.5, -1.1, 1.4], [0.1, 1.6, 1.6]]) {
        ctx.beginPath();
        ctx.arc(f.x + dx, f.y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    const r = 3.3 + (pulse ? 0.35 * Math.sin(now / 650 + i * 1.7) : 0);
    ctx.fillStyle = C.food;
    ctx.strokeStyle = C.foodRim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // moments: eaten food ripples, deaths burst and fade
  fx = fx.filter((e) => now - e.born < 800);
  for (const e of fx) {
    const t = (now - e.born) / (e.kind === "death" ? 800 : 450);
    if (t >= 1) continue;
    if (e.kind === "death") {
      ctx.fillStyle = stain(e.hue, 0.55 * (1 - t));
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3 + 0.4;
        ctx.beginPath();
        ctx.arc(e.x + Math.cos(ang) * (3 + 10 * t), e.y + Math.sin(ang) * (3 + 10 * t), 1.8 * (1 - t) + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = e.kind === "eat" ? C.foodRim : C.poison;
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3 + 10 * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // tracks in the agar: a short fading trail behind each creature
  if (effectsOn()) {
    for (const c of world.creatures) {
      if (!c.alive) continue;
      let t = trails.get(c.id);
      if (!t) trails.set(c.id, (t = []));
      const last = t[t.length - 1];
      if (!last || last.x !== c.x || last.y !== c.y) {
        if (last && (Math.abs(last.x - c.x) > 40 || Math.abs(last.y - c.y) > 40)) t.length = 0; // wrapped round the edge
        t.push({ x: c.x, y: c.y });
        if (t.length > 14) t.shift();
      }
      if (t.length < 2) continue;
      ctx.strokeStyle = stain(c.hue, 0.13);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      t.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  } else trails.clear();

  // creatures: stained cells; the tail beats faster the faster they swim, they fade as they starve
  for (const c of world.creatures) {
    if (!c.alive) continue;
    const swim = ((c.out[1] ?? 0) + 1) / 2; // 0..1
    const a = 0.35 + Math.min(c.energy, 1) * 0.55;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    ctx.strokeStyle = stain(c.hue, a * 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const phase = pulse ? (now / 1000) * (5 + swim * 14) + c.id : 0;
    for (let j = 0; j <= 8; j++) {
      const x = -6.5 - j * 1.5;
      const y = Math.sin(phase - j * 0.9) * (0.6 + swim * 1.6) * (j / 8);
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = stain(c.hue, a * 0.55);
    ctx.strokeStyle = stain(c.hue, Math.min(1, a + 0.25));
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stain(c.hue, Math.min(1, a + 0.35));
    ctx.beginPath();
    ctx.arc(1.8, 0, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // hunters: dark amoebae with moving edges; paler while resting after a catch
  world.hunters.forEach((h, idx) => {
    // a smooth outline through 10 points whose distance from the centre drifts slowly (pseudopods)
    const n = 10;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      const r = 10.5 + (pulse ? 1.3 * Math.sin(now / 700 + k * 1.37 + idx * 2.3) + 0.8 * Math.sin(now / 430 + k * 3.11 + idx) : 0);
      pts.push([h.x + Math.cos(ang) * r, h.y + Math.sin(ang) * r]);
    }
    const mid = (i: number) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
    ctx.beginPath();
    const m0 = mid(n - 1);
    ctx.moveTo(m0[0], m0[1]);
    for (let k = 0; k < n; k++) {
      const m = mid(k);
      ctx.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]);
    }
    ctx.closePath();
    ctx.fillStyle = C.hunter;
    ctx.globalAlpha = h.rest > 0 ? 0.25 : 0.5;
    ctx.fill();
    ctx.globalAlpha = h.rest > 0 ? 0.5 : 0.9;
    ctx.strokeStyle = C.hunter;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.hunter; // nucleus
    ctx.beginPath();
    ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  if (world.rules.walls) {
    ctx.strokeStyle = "rgba(30,43,48,0.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }
  if (selected && selected.alive) {
    drawSightLines(selected);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// What the selected creature senses right now: nearest food (solid), 2nd food (dashed), neighbour (dotted).
// Uses the same lookup as the engine, read-only.
function drawSightLines(c: Creature): void {
  const ctx = worldCtx;
  const r = world.rules;
  const walls = r.walls > 0;
  const line = (dx: number, dy: number, color: string, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + dx, c.y + dy); // may run off the edge when the world wraps: that's the short way round
    ctx.stroke();
  };
  const scan = scanFood(world, c.x, c.y, r.senseFood2 ? 2 : 1);
  const foods = scan.good;
  if (foods[0]) line(foods[0].dx, foods[0].dy, C.foodRim, []);
  if (r.senseFood2 && foods[1]) line(foods[1].dx, foods[1].dy, C.foodRim, [6, 5]);
  if (scan.poison) line(scan.poison.dx, scan.poison.dy, C.poison, [6, 5]);
  if (r.senseCreature) {
    const n = nearest(world.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
    if (n) line(n.dx, n.dy, hsl(n.item.hue), [2, 4]);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ---------- chart ----------
function drawChart(): void {
  $("chartTitle").textContent = inEcosystem(world) ? "Population over time" : `Food eaten${world.rules.layouts > 1 ? " per map" : ""}, each generation`;
  $("bandLegend").style.display = inEcosystem(world) ? "none" : "";
  $("lineLegend").textContent = inEcosystem(world) ? "Creatures alive" : "Average";
  if (inEcosystem(world)) return drawPopulationChart();
  const ctx = chartCtx;
  const w = 680, h = 300;
  const pad = { l: 44, r: 10, t: 12, b: 30 };
  const { avgHist, bestHist, worstHist } = world;
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, w, h);
  const max = Math.ceil(Math.max(5, ...bestHist)); // whole number: per-layout values can be fractions
  const n = bestHist.length;
  const x = (i: number) => pad.l + (n < 2 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);

  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (const v of [0, Math.round(max / 2), max]) {
    ctx.beginPath();
    ctx.moveTo(pad.l, y(v));
    ctx.lineTo(w - pad.r, y(v));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(v), pad.l - 8, y(v) + 7);
  }
  ctx.textAlign = "left";
  if (n === 0) {
    ctx.fillText("Appears after the first generation", pad.l + 8, h / 2);
    return;
  }
  ctx.fillText("gen 1", pad.l, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(`gen ${n}`, w - pad.r, h - 6);

  // band from worst to best: a wide band means very unequal creatures, a thin one means they're all alike
  ctx.fillStyle = C.pos;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  bestHist.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), y(worstHist[i]));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.pos;
  ctx.lineWidth = 3;
  ctx.beginPath();
  avgHist.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

// Ecosystem mode: population over time (one point every ECO_SAMPLE ticks).
function drawPopulationChart(): void {
  const ctx = chartCtx;
  const w = 680, h = 300;
  const pad = { l: 44, r: 10, t: 12, b: 30 };
  const pop = world.eco.popHist.slice(-300); // the last 30,000 ticks
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, w, h);
  const max = Math.max(10, ...pop);
  const n = pop.length;
  const x = (i: number) => pad.l + (n < 2 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);
  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (const v of [0, Math.round(max / 2), max]) {
    ctx.beginPath();
    ctx.moveTo(pad.l, y(v));
    ctx.lineTo(w - pad.r, y(v));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(v), pad.l - 8, y(v) + 7);
  }
  ctx.textAlign = "left";
  if (n === 0) {
    ctx.fillText(`Appears after ${ECO_SAMPLE} ticks`, pad.l + 8, h / 2);
    return;
  }
  ctx.fillText(`tick ${(world.eco.popHist.length - n) * ECO_SAMPLE}`, pad.l, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(`tick ${world.eco.popHist.length * ECO_SAMPLE}`, w - pad.r, h - 6);
  ctx.strokeStyle = C.pos;
  ctx.lineWidth = 3;
  ctx.beginPath();
  pop.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

// ---------- families ----------
// Counts living creatures only, so the bar changes as families starve during a generation.
function drawFamilies(): void {
  const living = world.creatures.filter((c) => c.alive);
  const counts = new Map<number, number>();
  for (const c of living) counts.set(c.family, (counts.get(c.family) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const ctx = famCtx;
  const w = 680, h = 28;
  ctx.clearRect(0, 0, w, h);
  if (living.length === 0) {
    $("familyText").textContent = "No one is alive. A new generation starts next tick.";
    return;
  }
  let x = 0;
  for (const [fam, n] of sorted) {
    const width = (n / living.length) * w;
    ctx.fillStyle = hsl(founderHue(fam));
    ctx.fillRect(x, 0, Math.max(width - 2, 1), h);
    x += width;
  }
  const lead = sorted[0];
  const newest = [...world.families.values()].reduce<null | Family>(
    (a, f) => (f.parent !== null && !f.newcomer && (!a || f.id > a.id) ? f : a), null);
  const crowns = [...world.families.values()].flatMap((f) => f.champions.map((ch) => ({ fam: f.id, gen: ch.generation })));
  const lastCrown = crowns.sort((a, b) => b.gen - a.gen)[0];
  const crownText = lastCrown ? ` Latest champion: family ${lastCrown.fam + 1}, generation ${lastCrown.gen}.` : "";
  const trials = [...world.branches.values()];
  const proof = world.rules.splitProof;
  const trialText = proof > 0
    ? ` Branches on trial: ${trials.length}` +
      (trials.length ? ` (best ${Math.max(...trials.map((b) => b.wins))} of ${proof} wins)` : "") + `, ${world.failedBranches} failed.`
    : "";
  $("familyText").textContent =
    `${sorted.length} alive, the biggest ${Math.round((lead[1] / living.length) * 100)}% of the living. ` +
    `${world.splits} split off this run` +
    (newest ? ` (newest: family ${newest.id + 1}, from ${newest.parent! + 1}).` : ".") +
    (inEcosystem(world) ? "" : trialText + newcomerText() + crownText); // trials, newcomers, champions: generations only
}

function newcomerText(): string {
  if (!world.rules.newcomers && !world.newcomerCount) return "";
  const prot = [...world.families.values()].filter((f) => f.newcomer && world.generation < f.protectedUntil);
  const list = prot.map((f) => `family ${f.id + 1} (${f.protectedUntil - world.generation} more)`).join(", ");
  return ` Newcomers: ${world.newcomerCount}` + (prot.length ? ` (protected: ${list}).` : ".");
}

// ---------- legacy ----------
let legacyShown = -1;
function drawLegacy(): void {
  if (world.legacy.length === legacyShown) return; // only rebuild the list when something died out
  legacyShown = world.legacy.length;
  const list = $("legacy");
  list.innerHTML = "";
  for (const f of world.legacy.slice(-6).reverse()) {
    const li = document.createElement("li");
    const from = f.parent === null ? "founder" : f.newcomer ? `newcomer from ${f.parent + 1}` : `from ${f.parent + 1}`;
    const champs = f.champions.length ? `, ${f.champions.length} champion${f.champions.length > 1 ? "s" : ""}` : "";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = hsl(founderHue(f.id));
    const what = document.createElement("span");
    what.className = "what";
    what.textContent = `Family ${f.id + 1}, ${from}` +
      (inEcosystem(world) ? "" : `: average ${mean(f.avgHist).toFixed(1)}, best ${food(f.bestEaten)}${champs}`);
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = `${f.bornInTicks ? "tick" : "gen"} ${f.bornGeneration} to ${f.diedGeneration}, peak ${f.peakSize}`;
    li.append(dot, what, when);
    list.append(li);
  }
  $("legacyText").textContent = world.legacy.length
    ? `${world.legacy.length} died out this run; newest first.`
    : "No family has died out yet.";
}

// ---------- brain ----------
const OUT_LABELS = ["Turn", "Speed"];

function drawBrain(c: Creature | null): void {
  const ctx = brainCtx;
  // taller canvas when there are many senses, so the labels stay readable
  const h = c && (c.inputs.length > 7 || c.hidden.length > 8) ? 600 : 440;
  if (ctx.canvas.height !== h) ctx.canvas.height = h;
  const w = 680;
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `22px ${FONT}`;
  if (!c) {
    ctx.fillStyle = C.muted;
    ctx.textAlign = "center";
    ctx.fillText("Click a creature in the world", w / 2, h / 2);
    return;
  }
  const nIn = c.inputs.length;
  const nHid = c.hidden.length;
  const inLabels = inputLabels(world.rules);
  const rowY = (n: number, i: number) => 30 + (i + 0.5) * ((h - 60) / n);
  const radius = Math.min(15, ((h - 60) / nIn) * 0.38); // more senses = smaller input circles
  const xs = [255, 420, 555];
  ctx.font = `${nIn > 7 ? 20 : 22}px ${FONT}`;
  const layers = [
    c.inputs.map((v, i) => ({ x: xs[0], y: rowY(nIn, i), v })),
    c.hidden.map((v, i) => ({ x: xs[1], y: rowY(nHid, i), v })),
    c.out.map((v, i) => ({ x: xs[2], y: rowY(OUT, i), v })),
  ];
  // weights, in the same order think() reads them
  let k = 0;
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, wgt: number) => {
    ctx.strokeStyle = wgt >= 0 ? C.pos : C.neg;
    ctx.globalAlpha = 0.15 + Math.min(Math.abs(wgt), 2) * 0.35;
    ctx.lineWidth = 1 + Math.min(Math.abs(wgt), 3) * 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  for (let hI = 0; hI < nHid; hI++) {
    for (let i = 0; i < nIn; i++) edge(layers[0][i], layers[1][hI], c.w[k++]);
    k++; // bias
  }
  for (let o = 0; o < OUT; o++) {
    for (let hI = 0; hI < nHid; hI++) edge(layers[1][hI], layers[2][o], c.w[k++]);
    k++; // bias
  }
  ctx.globalAlpha = 1;

  // neurons: fill shows how strongly each one is firing right now
  for (const [li, layer] of layers.entries()) {
    const rad = li === 0 ? radius : li === 1 ? Math.min(15, ((h - 60) / nHid) * 0.38) : 15;
    for (const node of layer) {
      const v = Math.max(-1, Math.min(1, node.v));
      ctx.fillStyle = C.field;
      ctx.beginPath();
      ctx.arc(node.x, node.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = v >= 0 ? C.pos : C.neg;
      ctx.globalAlpha = Math.abs(v);
      ctx.beginPath();
      ctx.arc(node.x, node.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.fillStyle = C.text;
  ctx.textAlign = "right";
  layers[0].forEach((n, i) => ctx.fillText(inLabels[i] ?? "", n.x - radius - 10, n.y + 6));
  ctx.textAlign = "left";
  ctx.font = `22px ${FONT}`;
  layers[2].forEach((n, i) => ctx.fillText(OUT_LABELS[i], n.x + 26, n.y + 7));
}

function brainCaption(c: Creature | null, picked: boolean): string {
  if (!c) return "";
  if (inEcosystem(world)) {
    const who = picked ? "Your pick" : "The oldest creature";
    const famE = world.families.get(c.family);
    const fromE = famE && famE.parent !== null ? ` (split from family ${famE.parent + 1} ${famE.bornInTicks ? "at tick" : "in generation"} ${famE.bornGeneration})` : "";
    return `${who}. Family ${c.family + 1}${fromE}, age ${c.age}, ${c.depth} generation${c.depth === 1 ? "" : "s"} from its founder, ` +
      `${c.children} child${c.children === 1 ? "" : "ren"}, ate ${c.eaten}` +
      (world.rules.poison > 0 ? ` (and ${c.poisoned} poison)` : "") + `, energy ${c.energy.toFixed(2)}.` +
      (world.rules.learnRate > 0 ? ` Learned during life: ${c.learned.toFixed(2)} total weight change.` : "");
  }
  const who = picked ? "Your pick" : "Last generation's best, copied unchanged";
  const state = c.alive ? `energy ${c.energy.toFixed(2)}` : `starved at tick ${c.diedAt}`;
  const fam = world.families.get(c.family);
  const origin = !fam || fam.parent === null ? ""
    : fam.newcomer ? ` (newcomer from family ${fam.parent + 1} in generation ${fam.bornGeneration}` +
      (world.generation < fam.protectedUntil ? `, protected ${fam.protectedUntil - world.generation} more generation${fam.protectedUntil - world.generation === 1 ? "" : "s"})` : ")")
    : ` (split from family ${fam.parent + 1} in generation ${fam.bornGeneration})`;
  const branch = c.branch !== null ? world.branches.get(c.branch) : undefined;
  const trial = branch
    ? ` On trial as a new branch since generation ${branch.bornGeneration}: out-ate the rest of its family ${branch.wins} of ${world.rules.splitProof} generations in a row.`
    : "";
  const streak = c.streak > 0 ? ` On top ${c.streak} generation${c.streak > 1 ? "s" : ""} in a row.` : "";
  const champ = fam?.champions.length ? ` Its family's main brain is a champion from generation ${fam.champions.at(-1)!.generation}.` : "";
  const ate = world.rules.layouts > 1
    ? `ate ${c.eaten} so far this generation (layout ${world.layout + 1} of ${world.rules.layouts})`
    : `ate ${c.eaten}`;
  const poisoned = world.rules.poison > 0 ? ` (and ${c.poisoned} poison)` : "";
  const learnedText = world.rules.learnRate > 0 ? ` Learned during life: ${c.learned.toFixed(2)} total weight change.` : "";
  return `${who}. Family ${c.family + 1}${origin}, ${ate}${poisoned}, ${state}.${trial}${streak}${champ}${learnedText}`;
}

// ---------- frame ----------
function draw(): void {
  updateMarks();
  let sel = world.creatures.find((c) => c.id === selectedId) ?? null;
  const picked = sel !== null;
  if (!sel) {
    sel = inEcosystem(world)
      ? world.creatures.reduce<Creature | null>((a, c) => (!a || c.age > a.age ? c : a), null) // follow the oldest
      : world.creatures.find((c) => c.elite) ?? null; // default: follow the champion
  }
  followed = sel;
  drawWorld(sel);
  drawChart();
  drawFamilies();
  drawLegacy();
  drawBrain(sel);
  $("brainText").textContent = brainCaption(sel, picked);
  $("brainTitle").textContent = sel ? "Brain, live" : "Brain";

  if (inEcosystem(world)) {
    const e = world.eco;
    setGen(`Tick ${world.tick}`, -1);
    setStats([[String(world.creatures.length), "alive now"], [String(e.births), "born"], [String(e.deaths), "died"]]);
    $("tickText").textContent = `${e.oldAge} died of old age.` +
      (e.rescues ? ` Everyone died ${e.rescues} time${e.rescues === 1 ? "" : "s"}; fresh founders were put in.` : "");
    return;
  }
  const alive = world.creatures.filter((c) => c.alive).length;
  const many = world.rules.layouts > 1;
  setGen(world.rules.mode === 1
    ? `Warm-up ${world.generation} of ${world.rules.ecoWarmup}` // ecosystem starts after these
    : `Generation ${world.generation}`, world.generation);
  const last = world.avgHist.length > 0;
  setStats([
    [`${alive}/${world.rules.pop}`, "alive now"],
    [last ? world.avgHist.at(-1)!.toFixed(1) : "-", "average food, last gen"],
    [last ? food(world.bestHist.at(-1)!) : "-", "best, last gen"],
  ]);
  const mapText = many ? `Food map ${world.layout + 1} of ${world.rules.layouts}, tick ${world.tick} of ${world.rules.genTicks}.` : `Tick ${world.tick} of ${world.rules.genTicks}.`;
  const poisonText = last && world.rules.poison > 0 ? ` Poison eaten last generation: ${world.poisonHist.at(-1)!.toFixed(1)} each.` : "";
  const caughtText = world.caughtHist.length ? ` Caught by hunters: ${Math.round(100 * world.caughtHist.at(-1)!)}% per map.` : "";
  const hb = world.hunterBrains;
  const brainText = hb.length && world.hunters.length
    ? ` Hunter brains: ${hb.filter((b) => b.origin === "borrowed").length} of ${hb.length} descend from a family that died out.`
    : world.rules.hunters > 0 && !world.hunters.length ? ` Hunters arrive in generation ${world.rules.hunterFrom}.` : "";
  const swapText = world.swapped ? " On this map the dark granules are the food and the pale beads the poison." : "";
  const note = runNote && world.generation === 1 ? `${runNote} ` : ""; // shown during the first generation
  $("tickText").textContent = `${note}${mapText}${poisonText}${caughtText}${brainText}${swapText}`;
}

// The generation number, written in the notebook; re-stamped (a small settle) when it changes.
let shownGen = -2;
function setGen(text: string, gen: number): void {
  const el = $("genText");
  if (el.textContent !== text) el.textContent = text;
  if (gen !== shownGen) {
    shownGen = gen;
    if (!reducedMotion && speed !== "max") {
      el.classList.remove("turn");
      void el.offsetWidth; // restart the animation
      el.classList.add("turn");
    }
  }
}

let statsShown = "";
function setStats(items: [string, string][]): void {
  const key = JSON.stringify(items);
  if (key === statsShown) return;
  statsShown = key;
  const box = $("stats");
  box.innerHTML = "";
  for (const [value, label] of items) {
    const d = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    d.append(b, span);
    box.append(d);
  }
}

function advance(): void {
  step(world);
  steps++;
}

function frame(): void {
  if (rebuilding) {
    // nothing: the link rebuild drives the world (openLink)
  } else if (speed === "max") {
    const end = performance.now() + 12;
    do advance();
    while (performance.now() < end);
  } else {
    for (let i = 0; i < speed; i++) advance();
  }
  draw();
  requestAnimationFrame(frame);
}

// ---------- controls ----------
function setSpeed(s: Speed): void {
  speed = s;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#speeds button")) {
    b.setAttribute("aria-pressed", String(b.dataset.speed === String(s)));
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#speeds button")) {
  b.onclick = () => setSpeed(b.dataset.speed === "max" ? "max" : (Number(b.dataset.speed) as Speed));
}

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    setSpeed(speed === 0 ? 1 : 0);
  }
  if (e.key === "1") setSpeed(1);
  if (e.key === "2") setSpeed(10);
  if (e.key === "3") setSpeed("max");
  if (e.key === "r" || e.key === "R") openRules();
});

$<HTMLCanvasElement>("world").addEventListener("click", (e) => {
  const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  let best: Creature | null = null;
  let bd = 16 * 16;
  for (const c of world.creatures) {
    if (!c.alive) continue;
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  selectedId = best ? best.id : null;
});

const RULE_SPECS: [keyof Rules, string, number, number, number, string][] = [
  ["mode", "Ecosystem mode (no generations)", 0, 1, 1, "Creatures have children when full, age and die; the population follows the food. Needs slow regrowth: switching it on sets food regrowth to 100."],
  ["birth", "Children need two parents", 0, 1, 1, "Ecosystem: two full creatures within 30 px. Off = a full creature splits in two."],
  ["birthEnergy", "Energy needed for a child", 0.8, 1.5, 0.05, "Ecosystem. The most a creature can hold is 1.5."],
  ["ageScale", "Age at which living costs double", 0, 10000, 500, "Ecosystem. 0 = no ageing."],
  ["ecoWarmup", "Warm-up generations before the ecosystem", 0, 50, 1, "Ecosystem starts with brains that can already eat. 0 = random brains (often die out)."],
  ["pop", "Creatures per generation", 10, 200, 1, ""],
  ["food", "Food on the map", 5, 200, 1, "Fewer = scarcer, harder to find."],
  ["genTicks", "Generation length (ticks)", 300, 5000, 100, ""],
  ["mutation", "Mutation strength", 0, 1, 0.01, "How far a child's brain drifts from its parent's."],
  ["parents", "Parents (top N breed)", 1, 50, 1, "Lower = harsher selection."],
  ["elite", "Best copied unchanged", 0, 10, 1, "Keeps the best brains from being lost to mutation."],
  ["splitDistance", "New family when a brain differs by", 0, 2, 0.05, "From its family's main brain. Lower = more families. 0 = never split."],
  ["splitProof", "Branch must out-eat its family N generations in a row", 0, 10, 1, "Before it counts as a new family. 0 = new family right away."],
  ["championStreak", "Champion after N generations on top", 0, 10, 1, "Its brain becomes the family's main brain. 0 = never."],
  ["layouts", "Food layouts per generation", 1, 5, 1, "Each brain is scored on this many maps. More = fairer scores, slower generations."],
  ["hidden", "Middle neurons per brain", 2, 16, 1, "More = can learn more complex behaviour, but more weights to evolve."],
  ["learnRate", "Learning during life", 0, 0.05, 0.001, "Food strengthens connections that were just active, poison weakens them. 0 = brains fixed for life."],
  ["inheritLearned", "Share of learning children inherit", 0, 1, 0.05, "0.75 = children start with 75% of what the parent learned."],
  ["thinkCost", "Energy cost of thinking", 0, 0.005, 0.0005, "Per tick, for a brain firing at full strength."],
  ["learnCost", "Energy cost of learning", 0, 0.1, 0.005, "Per unit of brain change."],
  ["forget", "Forgetting", 0, 0.01, 0.0005, "Share of learned change fading back to the inborn brain each tick. 0 = never forget."],
  ["relativeReward", "Reward vs usual intake", 0, 1, 1, "1 = a meal counts only as better or worse than usual. 0 = food +1, poison -1."],
  ["energyGate", "Learn less when hungry", 0, 1, 1, "1 = learning scales with current energy."],
  ["plasticity", "Evolve how each connection learns", 0, 1, 1, "1 = every connection gets its own learning rate, evolved in the genome (doubles it). Needs learning on."],
  ["hunters", "Hunters", 0, 20, 1, "Dark amoebae that hunt creatures (top speed 2; creatures up to 3). A caught creature is out for the rest of the food map."],
  ["hunterSense", "Creatures sense the nearest hunter", 0, 1, 1, "Adds 3 inputs to the brain when there are hunters."],
  ["hunterBrains", "Hunters evolve brains", 0, 1, 1, "Off = hunters chase the nearest creature. On = each hunter has a brain shaped like a creature's (its 'food' sense points at creatures) and the best catchers breed."],
  ["hunterFrom", "Hunters arrive in generation", 1, 50, 1, "With brains, half of the first hunters reuse the brains of families that died out, so give the creatures about 10 generations first."],
  ["swapKinds", "Food and poison swap looks", 0, 1, 1, "1 = on each food map a coin flip decides which look is poison. Born brains can't know; learning can. Try poison 0.5."],
  ["mutationRate", "Share of weights each child changes", 0.05, 1, 0.05, "1 = every weight a little. Lower = only a few weights (sparse)."],
  ["centreShare", "Children from the centre brain", 0, 1, 0.1, "Evolution Strategies: a weighted average of the best family's top parents."],
  ["newcomers", "Newcomer families per generation", 0, 5, 1, "A good brain mutated very hard, starting its own family."],
  ["newcomerMutation", "How hard newcomers are mutated", 0, 3, 0.05, "Mutation strength for newcomers only."],
  ["protectGens", "Newcomers protected for N generations", 0, 10, 1, "Its best keeps a seat and has a child, whatever its rank."],
  ["poison", "Share of food that is poison", 0, 0.5, 0.05, "Purple rings. Cost 0.5 energy, worth nothing. Adds a poison sense."],
  ["regrow", "Food regrows after N ticks", 0, 600, 20, "0 = an eaten pellet reappears somewhere else at once."],
  ["energyCost", "Energy cost of living and moving", 0.5, 3, 0.1, "x normal. Higher = harsher."],
  ["senseFood2", "Sense the second-nearest food", 0, 1, 1, "Adds 3 inputs to the brain."],
  ["senseCreature", "Sense the nearest creature", 0, 1, 1, "Adds 3 inputs to the brain."],
  ["walls", "Walls instead of wrapping around", 0, 1, 1, "Adds a 'wall ahead' sense."],
];

// The rules drawer, in groups. A rule left out of every group still shows, under "Other" (so a new rule is never hidden).
const RULE_GROUPS: [string, (keyof Rules)[]][] = [
  ["Population and time", ["pop", "genTicks", "layouts"]],
  ["Food", ["food", "poison", "regrow", "energyCost", "swapKinds"]],
  ["Senses and brain", ["senseFood2", "senseCreature", "walls", "hidden"]],
  ["Evolution", ["mutation", "mutationRate", "parents", "elite", "centreShare", "newcomers", "newcomerMutation", "protectGens"]],
  ["Families", ["splitDistance", "splitProof", "championStreak"]],
  ["Hunters", ["hunters", "hunterSense", "hunterBrains", "hunterFrom"]],
  ["Learning during life", ["learnRate", "inheritLearned", "thinkCost", "learnCost", "forget", "relativeReward", "energyGate", "plasticity"]],
  ["Ecosystem mode", ["mode", "birth", "birthEnergy", "ageScale", "ecoWarmup"]],
];

function renderRules(): void {
  const root = $("rules");
  root.innerHTML = "";
  const specs = new Map(RULE_SPECS.map((sp) => [sp[0], sp]));
  const grouped = new Set(RULE_GROUPS.flatMap(([, keys]) => keys));
  const other = RULE_SPECS.map((sp) => sp[0]).filter((k) => !grouped.has(k));
  for (const [title, keys] of other.length ? [...RULE_GROUPS, ["Other", other] as [string, (keyof Rules)[]]] : RULE_GROUPS) {
    const h = document.createElement("h3");
    h.textContent = title;
    root.append(h);
    for (const k of keys) {
      const sp = specs.get(k);
      if (sp) root.append(ruleRow(sp));
    }
  }
  updatePending();
}

function ruleRow([key, label, min, max, stepV, help]: (typeof RULE_SPECS)[number]): HTMLElement {
  {
    const id = `rule-${key}`;
    const div = document.createElement("div");
    div.className = "rule";
    div.dataset.key = key;
    if (max === 1 && stepV === 1) {
      // on/off rules are checkboxes
      div.classList.add("toggle");
      div.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" role="switch" ${pendingRules[key] ? "checked" : ""}> ${label}</label>
        ${help ? `<small>${help}</small>` : ""}`;
      const box = div.querySelector("input")!;
      box.onchange = () => {
        pendingRules[key] = box.checked ? 1 : 0;
        // instant regrowth means unlimited food: the population would grow until the safety limit
        if (key === "mode" && box.checked && pendingRules.regrow === 0) {
          pendingRules.regrow = 100;
          renderRules();
        }
        updatePending();
      };
      return div;
    }
    div.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${stepV}" value="${pendingRules[key]}">
      ${help ? `<small>${help}</small>` : ""}`;
    const input = div.querySelector("input")!;
    const out = div.querySelector("output")!;
    const show = () =>
      (out.textContent = ["mutation", "splitDistance", "newcomerMutation", "mutationRate", "centreShare", "poison", "energyCost", "birthEnergy", "inheritLearned"].includes(key) ? Number(input.value).toFixed(2)
        : ["learnRate", "learnCost", "thinkCost", "forget"].includes(key) ? Number(input.value).toFixed(4) : input.value);
    input.oninput = () => {
      pendingRules[key] = Number(input.value);
      show();
      updatePending();
    };
    show();
    return div;
  }
}

// Marks the rules that differ from the run on the dish, and counts them on the Rules button.
function updatePending(): void {
  if (!world) return;
  const changed = (Object.keys(pendingRules) as (keyof Rules)[]).filter((k) => pendingRules[k] !== world.rules[k]);
  for (const row of document.querySelectorAll<HTMLElement>("#rules .rule")) {
    row.classList.toggle("changed", changed.includes(row.dataset.key as keyof Rules));
  }
  $("rulesCount").textContent = changed.length ? String(changed.length) : "";
  $("pending").classList.toggle("waiting", changed.length > 0);
  $("pending").textContent = changed.length
    ? `${changed.length} change${changed.length === 1 ? "" : "s"} waiting for the next run.`
    : "Same rules as the run on the dish.";
}

// ---------- the rules drawer ----------
const rulesDialog = $<HTMLDialogElement>("rulesDialog");
function openRules(): void {
  if (!rulesDialog.open) rulesDialog.showModal();
}
$("openRules").onclick = openRules;
$("closeRules").onclick = () => rulesDialog.close();
rulesDialog.addEventListener("click", (e) => {
  if (e.target === rulesDialog) rulesDialog.close(); // a click on the dimmed page outside the drawer
});
$("applyRules").onclick = () => {
  startRun($<HTMLInputElement>("seed").value, pendingRules);
  updatePending();
  rulesDialog.close();
};
$("resetRules").onclick = () => {
  Object.assign(pendingRules, DEFAULT_RULES);
  renderRules();
};

function startRun(seedText: string, rules: Rules, start?: number[]): void {
  world = createWorld(seedFrom(seedText), rules, start);
  runSeed = seedText;
  runStart = start ? start.slice() : null;
  steps = 0;
  if (location.hash && !rebuilding) history.replaceState(null, "", location.pathname + location.search); // a new run: the old link no longer applies
  $("linkText").textContent = "";
  $<HTMLInputElement>("linkBox").hidden = true;
  runNote = "";
  selectedId = null;
  legacyShown = -1;
}

// ---------- hall of fame ----------
let fame: FameEntry[] = [];
let fameStored = true;

function fameMessage(text: string): void {
  $("fameText").textContent = text;
}

function renderFame(): void {
  const list = $("fame");
  list.innerHTML = "";
  for (const e of fame) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = hsl(e.hue);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = e.name; // textContent: names can come from imported files
    name.title = `Seed ${e.seed}, saved ${e.savedAt.slice(0, 10)}`;
    const watch = document.createElement("button");
    watch.textContent = "Watch";
    watch.onclick = () => watchSaved(e);
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      fame = fame.filter((x) => x.id !== e.id);
      fameStored = storeFame(fame);
      renderFame();
    };
    li.append(dot, name, watch, del);
    list.append(li);
  }
  if (!fame.length) fameMessage("No saved brains yet. Follow a creature (click it) and save its brain.");
  else if (!fameStored) fameMessage("This browser won't keep them after the page closes: use Export to keep them.");
  else fameMessage(`${fame.length} saved (at most ${FAME_LIMIT}). Kept in this browser; Export to keep them safe.`);
}

// A new run under the saved rules where every creature starts with the saved brain.
function watchSaved(e: FameEntry): void {
  try {
    startRun(e.seed, e.rules, e.genome);
  } catch (err) {
    fameMessage(`Can't start from this brain: ${(err as Error).message}`);
    return;
  }
  Object.assign(pendingRules, e.rules);
  renderRules();
  updatePending();
  $<HTMLInputElement>("seed").value = e.seed;
  runNote = `Started from a saved brain: ${e.name}. Everyone begins with it.`;
}

$("saveBrain").onclick = () => {
  const c = followed;
  if (!c) {
    fameMessage("Click a creature first (there is no champion to follow until generation 2).");
    return;
  }
  const per = inEcosystem(world) ? 1 : Math.max(1, world.layout + 1);
  const eaten = c.eaten / per;
  const entry: FameEntry = {
    id: `${Date.now().toString(36)}-${c.id}`,
    name: `Gen ${world.generation}, family ${c.family + 1}, ${food(Math.round(eaten * 10) / 10)} food so far`,
    savedAt: new Date().toISOString(),
    seed: runSeed,
    generation: world.generation,
    eaten,
    hue: c.hue,
    rules: { ...world.rules },
    genome: c.g.slice(),
  };
  fame = mergeFame([entry], fame);
  fameStored = storeFame(fame);
  renderFame();
};

$("exportFame").onclick = () => {
  const blob = new Blob([JSON.stringify(fame, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "evolution-lab-hall-of-fame.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("importFameBtn").onclick = () => $<HTMLInputElement>("importFame").click();
$<HTMLInputElement>("importFame").onchange = async (ev) => {
  const input = ev.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const got = parseFame(await file.text());
    fame = mergeFame(fame, got);
    fameStored = storeFame(fame);
    renderFame();
    fameMessage(`Imported ${got.length} brain(s). ${$("fameText").textContent}`);
  } catch (err) {
    fameMessage(`Couldn't import that file: ${(err as Error).message}`);
  }
};

$("newRun").onclick = () => {
  startRun($<HTMLInputElement>("seed").value, pendingRules);
  updatePending();
};

// ---------- run links ----------
$("copyLink").onclick = async () => {
  const hash = encodeLink({ seed: runSeed, rules: world.rules, steps, start: runStart });
  history.replaceState(null, "", hash);
  const link = location.href;
  const box = $<HTMLInputElement>("linkBox");
  box.value = link;
  box.hidden = false;
  box.select();
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    // clipboard can be blocked (file:// pages, some browsers): the link is selected in the box instead
  }
  const where = inEcosystem(world) ? `tick ${world.tick}` : `generation ${world.generation}, map ${world.layout + 1}, tick ${world.tick}`;
  $("linkText").textContent = `${copied ? "Copied" : "Select and copy"}: opens this run at ${where} (step ${steps}), paused.` +
    (location.protocol === "file:" ? " It points to this file on this computer." : "");
};

// Opening a link: same seed, rules and start brain, then the same number of steps, a slice per frame
// so the page stays responsive. Then paused, at exactly the moment the link was made.
let linkProblem = ""; // shown after the normal start when a link can't be used

function openLink(): boolean {
  let link;
  try {
    link = decodeLink(location.hash);
  } catch (err) {
    linkProblem = `Couldn't read this link (${(err as Error).message}); started a normal run instead.`;
    return false;
  }
  if (!link) return false;
  try {
    startRun(link.seed, link.rules, link.start ?? undefined);
  } catch (err) {
    rebuilding = false;
    linkProblem = `Couldn't rebuild this run (${(err as Error).message}); started a normal run instead.`;
    return false;
  }
  $<HTMLInputElement>("seed").value = link.seed;
  Object.assign(pendingRules, link.rules);
  setSpeed(0);
  rebuilding = true;
  const target = link.steps;
  const slice = () => {
    const end = performance.now() + 40;
    while (steps < target && performance.now() < end) advance();
    $("linkText").textContent = steps < target
      ? `Rebuilding the run from the link: step ${steps} of ${target} (generation ${world.generation})...`
      : `Rebuilt from a link: the exact same run at step ${target}, paused. Press 1× to carry on.`;
    if (steps < target) setTimeout(slice, 0);
    else rebuilding = false;
  };
  slice();
  return true;
}

if (!openLink()) {
  startRun("42", DEFAULT_RULES);
  $("linkText").textContent = linkProblem;
}
({ list: fame, stored: fameStored } = loadFame());
renderFame();
renderRules();
if (!rebuilding) setSpeed(1);
frame();

// For tests and curious people: the current world is reachable from the browser console.
(window as unknown as { lab: { world: () => World; steps: () => number } }).lab = { world: () => world, steps: () => steps };

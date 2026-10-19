// The page: drawing and controls. It reads the World but never changes how it evolves.
import { createWorld, founderHue, step, DEFAULT_RULES, W, H, type Creature, type Rules, type World } from "../engine/world.ts";
import { OUT } from "../engine/brain.ts";
import { foodFilters, inputLabels } from "../engine/senses.ts";
import { nearest } from "../engine/space.ts";
import { seedFrom } from "../engine/rng.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ctx2d = (id: string) => $<HTMLCanvasElement>(id).getContext("2d")!;
const worldCtx = ctx2d("world");
const chartCtx = ctx2d("chart");
const famCtx = ctx2d("families");
const brainCtx = ctx2d("brain");

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = {
  field: css("--field"), food: css("--food"), poison: css("--poison"), text: css("--text"), muted: css("--muted"),
  line: css("--line"), pos: css("--pos"), neg: css("--neg"), panel: css("--panel"),
};
const FONT = '"IBM Plex Sans", system-ui, sans-serif';
const hsl = (hue: number) => `hsl(${hue} 62% 64%)`;

type Speed = 0 | 1 | 10 | "max";
let world: World;
let speed: Speed = 1;
let selectedId: number | null = null;
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
    }
  }
}

// ---------- world ----------
function drawWorld(selected: Creature | null): void {
  const ctx = worldCtx;
  ctx.fillStyle = C.field;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1.5;
  for (const f of world.food) {
    if (f.readyAt > world.tick) continue; // eaten, not regrown yet
    ctx.beginPath();
    if (f.poison) {
      // a ring, not a dot: shape tells it apart from food and from any family colour
      ctx.strokeStyle = C.poison;
      ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = C.food;
      ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // death marks: strong when fresh, fading to faint but staying until the next layout
  ctx.strokeStyle = C.neg;
  ctx.lineWidth = 1.5;
  for (const m of marks) {
    ctx.globalAlpha = Math.max(0.15, 0.7 - (world.tick - m.tick) / 600);
    ctx.beginPath();
    ctx.moveTo(m.x - 3.5, m.y - 3.5);
    ctx.lineTo(m.x + 3.5, m.y + 3.5);
    ctx.moveTo(m.x + 3.5, m.y - 3.5);
    ctx.lineTo(m.x - 3.5, m.y + 3.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const c of world.creatures) {
    if (!c.alive) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    ctx.globalAlpha = 0.45 + Math.min(c.energy, 1) * 0.55; // fades as it starves
    ctx.fillStyle = hsl(c.hue);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 4.5);
    ctx.lineTo(-5, -4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (world.rules.walls) {
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }
  if (selected && selected.alive) {
    drawSightLines(selected);
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
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
  const skip = foodFilters(world);
  const foods = nearest(world.food, c.x, c.y, walls, r.senseFood2 ? 2 : 1, skip.good);
  if (foods[0]) line(foods[0].dx, foods[0].dy, C.food, []);
  if (r.senseFood2 && foods[1]) line(foods[1].dx, foods[1].dy, C.food, [6, 5]);
  if (r.poison > 0) {
    const p = nearest(world.food, c.x, c.y, walls, 1, skip.poison)[0];
    if (p) line(p.dx, p.dy, C.poison, [6, 5]);
  }
  if (r.senseCreature) {
    const n = nearest(world.creatures, c.x, c.y, walls, 1, (o) => o === c || !o.alive)[0];
    if (n) line(n.dx, n.dy, hsl(n.item.hue), [2, 4]);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ---------- chart ----------
function drawChart(): void {
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
  const newest = [...world.families.values()].reduce<null | { id: number; parent: number | null; bornGeneration: number }>(
    (a, f) => (f.parent !== null && !f.newcomer && (!a || f.id > a.id) ? f : a), null);
  const crowns = [...world.families.values()].flatMap((f) => f.champions.map((ch) => ({ fam: f.id, gen: ch.generation })));
  const lastCrown = crowns.sort((a, b) => b.gen - a.gen)[0];
  const crownText = lastCrown ? ` Latest champion: family ${lastCrown.fam + 1} adopted its champion's brain in generation ${lastCrown.gen}.` : "";
  const trials = [...world.branches.values()];
  const proof = world.rules.splitProof;
  const trialText = proof > 0
    ? ` ${trials.length ? `${trials.length} branch${trials.length > 1 ? "es are" : " is"} on trial` +
        ` (best: family ${trials.reduce((a, b) => (b.wins > a.wins ? b : a)).family + 1}'s, ${Math.max(...trials.map((b) => b.wins))} of ${proof} wins)`
      : "No branch is on trial"}; ${world.failedBranches} failed so far.`
    : "";
  $("familyText").textContent =
    (sorted.length === 1 ? "1 family has" : `${sorted.length} families have`) +
    ` living members. The biggest is ${Math.round((lead[1] / living.length) * 100)}% of the living. ` +
    (world.splits === 1 ? "1 new family has" : `${world.splits} new families have`) + " split off this run" +
    (newest ? `; the newest is family ${newest.id + 1}, from family ${newest.parent! + 1} in generation ${newest.bornGeneration}.` : ".") +
    trialText + newcomerText() + crownText;
}

function newcomerText(): string {
  if (!world.rules.newcomers && !world.newcomerCount) return "";
  const prot = [...world.families.values()].filter((f) => f.newcomer && world.generation < f.protectedUntil);
  const list = prot.map((f) => `family ${f.id + 1} (${f.protectedUntil - world.generation} more)`).join(", ");
  return ` ${world.newcomerCount} newcomer famil${world.newcomerCount === 1 ? "y" : "ies"} so far` +
    (prot.length ? `; protected now: ${list}.` : ".");
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
    const from = f.parent === null ? "an original founder" : f.newcomer ? `a newcomer from family ${f.parent + 1}` : `from family ${f.parent + 1}`;
    const champs = f.champions.length ? `, ${f.champions.length} champion${f.champions.length > 1 ? "s" : ""}` : "";
    li.innerHTML = `<span class="dot" style="background:${hsl(founderHue(f.id))}"></span>` +
      `Family ${f.id + 1}, ${from}: generations ${f.bornGeneration}&ndash;${f.diedGeneration}, ` +
      `peak ${f.peakSize} creature${f.peakSize === 1 ? "" : "s"}, average ${mean(f.avgHist).toFixed(1)}, best ${food(f.bestEaten)} food${champs}`;
    list.append(li);
  }
  $("legacyText").textContent = world.legacy.length
    ? `${world.legacy.length} families have died out this run. Newest first.`
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
    for (let i = 0; i < nIn; i++) edge(layers[0][i], layers[1][hI], c.g[k++]);
    k++; // bias
  }
  for (let o = 0; o < OUT; o++) {
    for (let hI = 0; hI < nHid; hI++) edge(layers[1][hI], layers[2][o], c.g[k++]);
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
  return `${who}. Family ${c.family + 1}${origin}, ${ate}${poisoned}, ${state}.${trial}${streak}${champ}`;
}

// ---------- frame ----------
function draw(): void {
  updateMarks();
  let sel = world.creatures.find((c) => c.id === selectedId) ?? null;
  const picked = sel !== null;
  if (!sel) sel = world.creatures.find((c) => c.elite) ?? null; // default: follow the champion
  drawWorld(sel);
  drawChart();
  drawFamilies();
  drawLegacy();
  drawBrain(sel);
  $("brainText").textContent = brainCaption(sel, picked);
  $("brainTitle").textContent = sel ? "Brain, live" : "Brain";

  const alive = world.creatures.filter((c) => c.alive).length;
  const many = world.rules.layouts > 1;
  $("genText").textContent = `Generation ${world.generation}`;
  const layoutText = many ? `Food layout ${world.layout + 1} of ${world.rules.layouts}. ` : "";
  const last = world.avgHist.length
    ? ` Last generation: average ${world.avgHist.at(-1)!.toFixed(1)}, best ${food(world.bestHist.at(-1)!)}${many ? " food per layout" : ""}` +
      (world.rules.poison > 0 ? `, poison ${world.poisonHist.at(-1)!.toFixed(1)} each.` : ".")
    : "";
  $("tickText").textContent = `${layoutText}Tick ${world.tick} of ${world.rules.genTicks}, ${alive} of ${world.rules.pop} alive.${last}`;
}

function frame(): void {
  if (speed === "max") {
    const end = performance.now() + 12;
    do step(world);
    while (performance.now() < end);
  } else {
    for (let i = 0; i < speed; i++) step(world);
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

function renderRules(): void {
  const root = $("rules");
  root.innerHTML = "";
  for (const [key, label, min, max, stepV, help] of RULE_SPECS) {
    const id = `rule-${key}`;
    const div = document.createElement("div");
    div.className = "rule";
    if (max === 1 && stepV === 1) {
      // on/off rules are checkboxes
      div.classList.add("toggle");
      div.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" ${pendingRules[key] ? "checked" : ""}> ${label}</label>
        ${help ? `<small>${help}</small>` : ""}`;
      const box = div.querySelector("input")!;
      box.onchange = () => {
        pendingRules[key] = box.checked ? 1 : 0;
        updatePending();
      };
      root.append(div);
      continue;
    }
    div.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${stepV}" value="${pendingRules[key]}">
      ${help ? `<small>${help}</small>` : ""}`;
    const input = div.querySelector("input")!;
    const out = div.querySelector("output")!;
    const show = () =>
      (out.textContent = ["mutation", "splitDistance", "newcomerMutation", "mutationRate", "centreShare", "poison", "energyCost"].includes(key) ? Number(input.value).toFixed(2) : input.value);
    input.oninput = () => {
      pendingRules[key] = Number(input.value);
      show();
      updatePending();
    };
    show();
    root.append(div);
  }
}

function updatePending(): void {
  const changed = (Object.keys(pendingRules) as (keyof Rules)[]).some((k) => pendingRules[k] !== world.rules[k]);
  $("pending").textContent = changed ? "Changed rules apply when you start a new run." : "";
}

function startRun(seedText: string, rules: Rules): void {
  world = createWorld(seedFrom(seedText), rules);
  selectedId = null;
  legacyShown = -1;
}

$("newRun").onclick = () => {
  startRun($<HTMLInputElement>("seed").value, pendingRules);
  updatePending();
};

startRun("42", DEFAULT_RULES);
renderRules();
setSpeed(1);
frame();

// For tests and curious people: the current world is reachable from the browser console.
(window as unknown as { lab: { world: () => World } }).lab = { world: () => world };

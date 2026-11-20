// The project report (Rey 2026-11-19: "make it progressive: a report of how we did it, from the brain's activity to the end";
// 2026-11-20: one chapter per major change, short version of 7 chapters + the 15-change timeline). One page; each built chapter
// runs the real engine live in the browser with a before / after switch for that chapter's change. It reads the worlds and never
// changes how they evolve. Built: chapters 1-5. Chapters 6-7 wait for the overnight results (2026-11-20).
// Each chapter runs the rules of its time (results before 2026-11-11 used fast hunters), so its live world matches its numbers.
import { createWorld, step, DEFAULT_RULES, W, H, type Creature, type Rules, type World } from "../engine/world.ts";
import { OUT } from "../engine/brain.ts";
import { inputLabels, EYE_R } from "../engine/senses.ts";
import { SICK } from "../engine/toxin.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = {
  field: css("--field"), food: css("--food"), rim: css("--food-rim"), poison: css("--poison"), hunter: css("--hunter"),
  prey: css("--prey"), sick: css("--sick"), glow: css("--glow"), text: css("--text"), muted: css("--muted"), line: css("--line"),
  pos: css("--pos"), neg: css("--neg"), panel: css("--panel"), accent: css("--accent"),
};
const FONT = '"Recursive", system-ui, sans-serif';
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "–");

// The rules of each era. FAST = the hunter energy rules before 2026-11-11 (now the slow ones are the engine default).
const FAST = { hunterHunger: 0.0025, hunterMeal: 0.5 };
const SLOW = { hunterHunger: 0.000625, hunterMeal: 0.125 };
// The living world (ecosystem mode) as tested: plants with roots, 4 hunters to start.
const LIFE: Partial<Rules> = { mode: 1, hunters: 4, food: 60, foodSpread: 0.0005, regrow: 100, ecoWarmup: 0, birth: 0, senseFood2: 1, senseCreature: 1 };
// The poison proofs from 2026-11-08 on: both eyes, hunters breed like prey, full poison.
const PROOF: Partial<Rules> = { ...LIFE, poison: 0.3, eye: 4, hunterEye: 4, eyeMotion: 1, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1 };

// --- drawing a world -------------------------------------------------------------------------------------------------
function drawWorld(cx: CanvasRenderingContext2D, w: World, opts: { glow: boolean; follow?: Creature | null }): void {
  cx.fillStyle = C.field;
  cx.fillRect(0, 0, W, H);
  for (const f of w.food) {
    if (f.readyAt > w.tick) continue;
    if (f.poison) {
      cx.fillStyle = C.poison;
      cx.fillRect(f.x - 2.5, f.y - 2.5, 5, 5);
    } else {
      cx.beginPath();
      cx.arc(f.x, f.y, 3, 0, Math.PI * 2);
      cx.fillStyle = C.food;
      cx.fill();
      cx.strokeStyle = C.rim;
      cx.lineWidth = 1;
      cx.stroke();
    }
  }
  for (const c of w.creatures) {
    if (!c.alive) continue;
    const sick = c.toxin > SICK;
    if (sick && opts.glow) {
      cx.beginPath();
      cx.arc(c.x, c.y, 11, 0, Math.PI * 2);
      cx.fillStyle = C.glow;
      cx.fill();
    }
    cx.beginPath();
    cx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    cx.fillStyle = sick ? C.sick : C.prey;
    cx.fill();
    cx.beginPath();
    cx.moveTo(c.x, c.y);
    cx.lineTo(c.x + Math.cos(c.a) * 9, c.y + Math.sin(c.a) * 9);
    cx.strokeStyle = sick ? C.sick : C.prey;
    cx.lineWidth = 2;
    cx.stroke();
  }
  if (opts.follow && opts.follow.alive) {
    const c = opts.follow;
    cx.beginPath();
    cx.arc(c.x, c.y, 14, 0, Math.PI * 2);
    cx.strokeStyle = C.accent;
    cx.lineWidth = 2.5;
    cx.stroke();
  }
  for (const h of w.hunters) {
    const a = h.brain ? h.brain.a : 0;
    cx.save();
    cx.translate(h.x, h.y);
    cx.rotate(a);
    cx.beginPath();
    cx.moveTo(10, 0);
    cx.lineTo(-7, 6);
    cx.lineTo(-4, 0);
    cx.lineTo(-7, -6);
    cx.closePath();
    cx.fillStyle = C.hunter;
    cx.fill();
    cx.restore();
  }
}

// Runs a chapter only while it is on screen (saves the visitor's battery).
function whenVisible(el: HTMLElement, on: (v: boolean) => void): void {
  try {
    new IntersectionObserver((es) => on(es[0].isIntersecting), { threshold: 0.15 }).observe(el);
  } catch {
    on(true);
  }
}

// A before / after switch: buttons with data-v inside #id; calls back with the chosen value.
function switcher(id: string, on: (v: number) => void): void {
  const bs = $(id).querySelectorAll<HTMLButtonElement>("button");
  bs.forEach((b) => (b.onclick = () => {
    bs.forEach((x) => x.classList.toggle("on", x === b));
    on(Number(b.dataset.v));
  }));
}

const hunterDieOuts = (w: World) => w.eco.rounds.filter((r) => r.died !== "prey").length;
const alivePrey = (w: World) => { let n = 0; for (const c of w.creatures) if (c.alive) n++; return n; };
const sickShare = (w: World) => { let n = 0, s = 0; for (const c of w.creatures) if (c.alive) { n++; if (c.toxin > SICK) s++; } return n ? s / n : 0; };
const pickSoFar = (w: World) => {
  const k = w.eco.sick;
  return k.caught && k.samples ? (k.caughtSick / k.caught) / (k.sickShare / k.samples) : NaN;
};

// --- a live chapter with one or more worlds ---------------------------------------------------------------------------
// Controls by convention: [data-speed=p] buttons, #p-skip, #p-reset, #p-tick. All worlds start from seed 1 and step together.
interface SideSpec { rules: Rules; canvas: string; glow: boolean; stats?: string; text?: (w: World) => string }
interface Side extends SideSpec { w: World; cx: CanvasRenderingContext2D }
function live(section: string, p: string, build: () => SideSpec[], after?: (sides: Side[]) => void): { restart: () => void } {
  let sides: Side[] = [];
  let speed = 2, visible = false, skipTo = 0;
  const restart = () => {
    sides = build().map((s) => ({ ...s, w: createWorld(1, s.rules), cx: $<HTMLCanvasElement>(s.canvas).getContext("2d")! }));
    skipTo = 0;
  };
  restart();
  const speedBtns = document.querySelectorAll<HTMLButtonElement>(`[data-speed="${p}"]`);
  speedBtns.forEach((b) => (b.onclick = () => {
    speed = Number(b.dataset.v);
    speedBtns.forEach((x) => x.classList.toggle("on", x === b));
  }));
  $<HTMLButtonElement>(`${p}-skip`).onclick = () => { if (!skipTo) skipTo = sides[0].w.tick + 20000; };
  $<HTMLButtonElement>(`${p}-reset`).onclick = restart;
  whenVisible($(section), (v) => (visible = v));
  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (skipTo) {
      const t0 = performance.now();
      while (performance.now() - t0 < 16 && sides[0].w.tick < skipTo) for (const s of sides) step(s.w);
      if (sides[0].w.tick >= skipTo) skipTo = 0;
    } else for (let i = 0; i < speed; i++) for (const s of sides) step(s.w);
    for (const s of sides) {
      drawWorld(s.cx, s.w, { glow: s.glow });
      if (s.stats && s.text) $(s.stats).textContent = s.text(s.w);
    }
    after?.(sides);
    $(`${p}-tick`).textContent = skipTo ? `Skipping ahead… tick ${sides[0].w.tick} of ${skipTo}` : `Tick ${sides[0].w.tick}`;
  };
  requestAnimationFrame(frame);
  return { restart };
}

// --- chapter 1: a brain that evolves ---------------------------------------------------------------------------------
// Generations mode, the basic world: 40 creatures, food only, 4 senses, 6 middle neurons, 2 outputs (44 weights), 3 maps.
// Switch: before = random brains (generation 0); after = 20 generations of evolution, run fast, then watched.
function chapterBrain(): void {
  const rules: Rules = { ...DEFAULT_RULES, poison: 0, senseCreature: 0, senseFood2: 0, hunters: 0 };
  const wcx = $<HTMLCanvasElement>("c1-world").getContext("2d")!;
  const bcx = $<HTMLCanvasElement>("c1-brain").getContext("2d")!;
  const ccx = $<HTMLCanvasElement>("c1-chart").getContext("2d")!;
  const labels = inputLabels(rules);
  let w = createWorld(1, rules);
  let follow: Creature | null = null;
  let playing = true, visible = false, evolveLeft = 0;
  const pick = () => {
    let best: Creature | null = null;
    for (const c of w.creatures) if (c.alive && (!best || c.eaten > best.eaten)) best = c;
    return best;
  };
  const playBtn = $<HTMLButtonElement>("c1-play"), status = $("c1-status");
  switcher("c1-switch", (v) => { w = createWorld(1, rules); follow = null; evolveLeft = v ? 20 : 0; });
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; };
  whenVisible($("ch1"), (v) => (visible = v));

  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (evolveLeft > 0) {
      const g0 = w.generation;
      const t0 = performance.now();
      while (performance.now() - t0 < 14 && evolveLeft > 0) {
        step(w);
        if (w.generation !== g0) { evolveLeft--; break; }
      }
      follow = null;
    } else if (playing) {
      for (let i = 0; i < 2; i++) step(w);
    }
    if (!follow || !follow.alive || w.tick % 300 === 0) follow = pick();
    drawWorld(wcx, w, { glow: false, follow });
    drawBrain(bcx, follow, labels);
    drawScores(ccx, w);
    const last = w.avgHist.length ? w.avgHist[w.avgHist.length - 1] : NaN;
    status.textContent = evolveLeft > 0
      ? `Evolving… generation ${w.generation} (${evolveLeft} to go)`
      : `Generation ${w.generation}, food map ${w.layout + 1} of ${rules.layouts}, tick ${w.tick} of ${rules.genTicks}` +
        (w.avgHist.length ? ` · last generation ate ${fmt(last, 1)} pellets per map on average` : " · random brains, no evolution yet");
  };
  requestAnimationFrame(frame);
}

// The brain: inputs on the left, middle neurons, outputs on the right. A connection's colour is its sign (blue +, red -),
// its width its size; a neuron's fill is how strongly it fires right now (-1..1).
function drawBrain(cx: CanvasRenderingContext2D, c: Creature | null, labels: string[]): void {
  const BW = cx.canvas.width, BH = cx.canvas.height;
  cx.fillStyle = C.panel;
  cx.fillRect(0, 0, BW, BH);
  if (!c) return;
  const n = c.inputs.length, nh = c.hidden.length;
  const g = c.w;
  const col = (x: number) => [150, BW / 2, BW - 110][x];
  const yOf = (i: number, k: number) => 30 + ((BH - 60) * (i + 0.5)) / k;
  let k = 0;
  for (let h = 0; h < nh; h++) {
    for (let i = 0; i < n; i++) line(col(0), yOf(i, n), col(1), yOf(h, nh), g[k++]);
    k++; // bias
  }
  for (let o = 0; o < OUT; o++) {
    for (let h = 0; h < nh; h++) line(col(1), yOf(h, nh), col(2), yOf(o, OUT), g[k++]);
    k++;
  }
  function line(x1: number, y1: number, x2: number, y2: number, v: number) {
    cx.beginPath();
    cx.moveTo(x1, y1);
    cx.lineTo(x2, y2);
    cx.strokeStyle = v >= 0 ? C.pos : C.neg;
    cx.globalAlpha = Math.min(0.85, 0.15 + Math.abs(v) * 0.35);
    cx.lineWidth = Math.min(5, 0.5 + Math.abs(v) * 1.6);
    cx.stroke();
    cx.globalAlpha = 1;
  }
  const node = (x: number, y: number, v: number) => {
    cx.beginPath();
    cx.arc(x, y, 11, 0, Math.PI * 2);
    cx.fillStyle = C.panel;
    cx.fill();
    cx.beginPath();
    cx.arc(x, y, 11, 0, Math.PI * 2);
    cx.fillStyle = v >= 0 ? C.pos : C.neg;
    cx.globalAlpha = Math.min(1, Math.abs(v));
    cx.fill();
    cx.globalAlpha = 1;
    cx.strokeStyle = C.text;
    cx.lineWidth = 1;
    cx.stroke();
  };
  cx.font = `13px ${FONT}`;
  cx.fillStyle = C.text;
  cx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    node(col(0), yOf(i, n), c.inputs[i]);
    cx.fillStyle = C.text;
    cx.textAlign = "right";
    cx.fillText(labels[i] ?? `input ${i + 1}`, col(0) - 18, yOf(i, n));
  }
  for (let h = 0; h < nh; h++) node(col(1), yOf(h, nh), c.hidden[h]);
  const outs = ["Turn", "Speed"];
  for (let o = 0; o < OUT; o++) {
    node(col(2), yOf(o, OUT), c.out[o]);
    cx.fillStyle = C.text;
    cx.textAlign = "left";
    cx.fillText(`${outs[o]} ${fmt(c.out[o])}`, col(2) + 18, yOf(o, OUT));
  }
  cx.textAlign = "center";
  cx.fillStyle = C.muted;
  cx.fillText("senses", col(0), 14);
  cx.fillText("middle neurons", col(1), 14);
  cx.fillText("actions", col(2), 14);
}

// Food eaten per map, average of each generation.
function drawScores(cx: CanvasRenderingContext2D, w: World, title = "food eaten per map, average of each generation"): void {
  const CW = cx.canvas.width, CH = cx.canvas.height;
  cx.fillStyle = C.panel;
  cx.fillRect(0, 0, CW, CH);
  const ys = w.avgHist;
  cx.font = `12px ${FONT}`;
  cx.fillStyle = C.muted;
  cx.textAlign = "left";
  cx.textBaseline = "top";
  cx.fillText(title, 8, 6);
  if (ys.length < 2) return;
  const top = Math.max(10, ...ys) * 1.1;
  cx.beginPath();
  ys.forEach((y, i) => {
    const x = 8 + ((CW - 16) * i) / (ys.length - 1), yy = CH - 8 - ((CH - 34) * y) / top;
    if (i) cx.lineTo(x, yy); else cx.moveTo(x, yy);
  });
  cx.strokeStyle = C.accent;
  cx.lineWidth = 2;
  cx.stroke();
  cx.textAlign = "right";
  cx.fillStyle = C.text;
  cx.fillText(fmt(ys[ys.length - 1], 1), CW - 8, 6);
}

// Prey and hunters alive over time (the last 30,000 ticks of samples), one shared scale.
function drawPops(cx: CanvasRenderingContext2D, w: World): void {
  const CW = cx.canvas.width, CH = cx.canvas.height;
  cx.fillStyle = C.panel;
  cx.fillRect(0, 0, CW, CH);
  const N = 300;
  const prey = w.eco.popHist.slice(-N), hunt = w.eco.hunterPopHist.slice(-N);
  cx.font = `12px ${FONT}`;
  cx.textAlign = "left";
  cx.textBaseline = "top";
  cx.fillStyle = C.muted;
  cx.fillText("animals alive over time (last 30,000 ticks)", 8, 6);
  if (prey.length < 2) return;
  const top = Math.max(10, ...prey, ...hunt) * 1.1;
  const plot = (ys: number[], col: string) => {
    cx.beginPath();
    ys.forEach((y, i) => {
      const x = 8 + ((CW - 16) * i) / (N - 1), yy = CH - 10 - ((CH - 40) * y) / top;
      if (i) cx.lineTo(x, yy); else cx.moveTo(x, yy);
    });
    cx.strokeStyle = col;
    cx.lineWidth = 2;
    cx.stroke();
  };
  plot(prey, C.prey);
  plot(hunt, C.hunter);
  cx.textAlign = "right";
  cx.fillStyle = C.prey;
  cx.fillText(`prey ${prey[prey.length - 1]}`, CW - 90, 6);
  cx.fillStyle = C.hunter;
  cx.fillText(`hunters ${hunt[hunt.length - 1] ?? 0}`, CW - 8, 6);
}

// --- chapter 2: hunters, and a world that runs itself ----------------------------------------------------------------
// Before: generations mode with 4 evolving hunters (a judge ends each round); no poison. After: the living world as built on
// 2026-10-23 (fast hunters, engine breeding, plants with roots), no poison.
function chapterLife(): void {
  let mode = 0;
  const gens: Rules = { ...DEFAULT_RULES, poison: 0, hunters: 4, hunterBrains: 1 };
  const life: Rules = { ...DEFAULT_RULES, ...LIFE, poison: 0, ...FAST };
  const chart = $<HTMLCanvasElement>("c2-chart").getContext("2d")!;
  const r = live("ch2", "c2", () => [{
    rules: mode ? life : gens, canvas: "c2-world", glow: false, stats: "c2-stats",
    text: (w) => mode
      ? `prey ${alivePrey(w)} · hunters ${w.hunters.length} · hunter babies ${w.eco.hunterBirths} · hunter deaths ${w.eco.hunterDeaths} · hunters died out ${hunterDieOuts(w)}×`
      : `generation ${w.generation}, round ${w.layout + 1} of ${gens.layouts}, tick ${w.tick} of ${gens.genTicks} · ` +
        `hunters ${w.hunters.length}, always: they never get hungry and never have babies`,
  }], (sides) => {
    if (mode) drawPops(chart, sides[0].w);
    else drawScores(chart, sides[0].w, "prey: food eaten per map, each generation (the judge's score)");
  });
  switcher("c2-switch", (v) => { mode = v; r.restart(); });
}

// --- chapter 3: poison, and a real eye --------------------------------------------------------------------------------
// The living world of late October: fast hunters, engine breeding, hunters see prey speed (hunterCue 1, their old senses); prey
// have the 4-slice eye. Switch: poison 0 vs 0.3. The ringed prey's eye slices are drawn on the world and read out in a grid.
function chapterEye(): void {
  let mode = 1;
  const base: Rules = { ...DEFAULT_RULES, ...LIFE, eye: 4, ...FAST };
  const eye = $<HTMLCanvasElement>("c3-eye").getContext("2d")!;
  let follow: Creature | null = null;
  const r = live("ch3", "c3", () => [{
    rules: { ...base, poison: mode ? 0.3 : 0 }, canvas: "c3-world", glow: false, stats: "c3-stats",
    text: (w) => `prey ${alivePrey(w)} · sick now ${Math.round(sickShare(w) * 100)}% · hunters ${w.hunters.length} · hunters died out ${hunterDieOuts(w)}×`,
  }], (sides) => {
    const s = sides[0];
    if (!follow || !follow.alive || !s.w.creatures.includes(follow)) {
      follow = null;
      let best = Infinity;
      for (const c of s.w.creatures) {
        if (!c.alive) continue;
        const d = (c.x - W / 2) ** 2 + (c.y - H / 2) ** 2;
        if (d < best) { best = d; follow = c; }
      }
    }
    drawEye(s.cx, eye, follow);
  });
  switcher("c3-switch", (v) => { mode = v; follow = null; r.restart(); });
}

// Slice order in the engine's 4-slice eye (senses.ts eyeInto): 0 = right of the heading, 1 = behind, 2 = left, 3 = ahead.
// Channels (EYE_CHANNELS): green, purple, creature, hunter; input index = channel x 4 + slice.
const SLICE_ANGLE = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];
function drawEye(wcx: CanvasRenderingContext2D, cx: CanvasRenderingContext2D, c: Creature | null): void {
  const CW = cx.canvas.width, CH = cx.canvas.height;
  cx.fillStyle = C.panel;
  cx.fillRect(0, 0, CW, CH);
  if (!c || !c.alive) return;
  const v = (ch: number, sl: number) => c.inputs[ch * 4 + sl] ?? 0;
  // on the world: four wedges, tinted by how much poison each slice sees
  for (let sl = 0; sl < 4; sl++) {
    const mid = c.a + SLICE_ANGLE[sl];
    wcx.beginPath();
    wcx.moveTo(c.x, c.y);
    wcx.arc(c.x, c.y, EYE_R, mid - Math.PI / 4, mid + Math.PI / 4);
    wcx.closePath();
    wcx.fillStyle = C.poison;
    wcx.globalAlpha = 0.03 + Math.min(1, Math.sqrt(v(1, sl) / 10)) * 0.3; // sums run 0 to ~20: square root keeps small ones visible
    wcx.fill();
    wcx.globalAlpha = 0.5;
    wcx.strokeStyle = C.accent;
    wcx.lineWidth = 1;
    wcx.stroke();
    wcx.globalAlpha = 1;
  }
  wcx.beginPath();
  wcx.arc(c.x, c.y, 14, 0, Math.PI * 2);
  wcx.strokeStyle = C.accent;
  wcx.lineWidth = 2.5;
  wcx.stroke();
  // the read-out grid: rows = what, columns = where
  const rows = [["plants", C.rim], ["poison plants", C.poison], ["other prey", C.prey], ["hunters", C.hunter]];
  const cols: [string, number][] = [["ahead", 3], ["right", 0], ["behind", 1], ["left", 2]];
  const x0 = 130, y0 = 34, cw = (CW - x0 - 10) / 4, rh = (CH - y0 - 8) / 4;
  cx.font = `13px ${FONT}`;
  cx.textBaseline = "middle";
  cx.textAlign = "center";
  cx.fillStyle = C.muted;
  cols.forEach(([name], j) => cx.fillText(name, x0 + cw * (j + 0.5), 16));
  rows.forEach(([name, col], i) => {
    cx.textAlign = "right";
    cx.fillStyle = C.text;
    cx.fillText(name, x0 - 10, y0 + rh * (i + 0.5));
    cols.forEach(([, sl], j) => {
      const val = v(i, sl);
      const x = x0 + cw * j + 3, y = y0 + rh * i + 3;
      cx.fillStyle = col;
      const al = 0.06 + Math.min(1, Math.sqrt(val / 10)) * 0.84;
      cx.globalAlpha = al;
      cx.fillRect(x, y, cw - 6, rh - 6);
      cx.globalAlpha = 1;
      cx.textAlign = "center";
      cx.fillStyle = al > 0.55 ? "#fff" : C.text;
      cx.fillText(fmt(val, 1), x + (cw - 6) / 2, y + (rh - 6) / 2);
    });
  });
}

// --- chapter 4: hunters learn to dodge ---------------------------------------------------------------------------------
// Two worlds, same seed, one difference: hunters see a glow on sick prey (left) or nothing (right). The proof of 2026-11-08
// (gS3 / bS3): fast hunters, prey-like hunter breeding, both eyes, full poison (dose 1).
function chapterGlow(): void {
  const base: Rules = { ...DEFAULT_RULES, ...PROOF, ...FAST };
  const text = (w: World) => `prey ${alivePrey(w)} · hunters ${w.hunters.length} · sick now ${Math.round(sickShare(w) * 100)}% · ` +
    `catches ${w.eco.sick.caught} · pick so far ${fmt(pickSoFar(w))}`;
  live("ch4", "c4", () => [
    { rules: { ...base, hunterCue: 2 }, canvas: "c4-glow", glow: true, stats: "c4-g-stats", text },
    { rules: { ...base, hunterCue: 0 }, canvas: "c4-blind", glow: false, stats: "c4-b-stats", text },
  ]);
}

// --- chapter 5: making it natural --------------------------------------------------------------------------------------
// The same glow world with fast (before 2026-11-11) and slow hunters (the default since), side by side.
function chapterSlow(): void {
  const base: Rules = { ...DEFAULT_RULES, ...PROOF, hunterCue: 2 };
  const text = (w: World) => {
    const prey = alivePrey(w);
    return `prey ${prey} · hunters ${w.hunters.length} · hunters per 100 prey ${prey ? Math.round((100 * w.hunters.length) / prey) : "–"} · ` +
      `hunters died out ${hunterDieOuts(w)}×`;
  };
  live("ch5", "c5", () => [
    { rules: { ...base, ...FAST }, canvas: "c5-fast", glow: true, stats: "c5-f-stats", text },
    { rules: { ...base, ...SLOW }, canvas: "c5-slow", glow: true, stats: "c5-s-stats", text },
  ]);
}

chapterBrain();
chapterLife();
chapterEye();
chapterGlow();
chapterSlow();

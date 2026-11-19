// The project report (Rey 2026-11-19: "make it progressive: a report of how we did it, from the brain's activity to the end").
// One page, one chapter per step of the project; each built chapter runs the real engine live in the browser. It reads the
// worlds and never changes how they evolve. Built chapters so far: 1 (one creature's brain) and 8 (poison up the food chain).
import { createWorld, step, DEFAULT_RULES, W, H, type Creature, type Rules, type World } from "../engine/world.ts";
import { OUT } from "../engine/brain.ts";
import { inputLabels } from "../engine/senses.ts";
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

// --- chapter 1: one creature's brain ---------------------------------------------------------------------------------
// Generations mode, the basic world: 40 creatures, food only, 4 senses, 6 middle neurons, 2 outputs.
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
  const evolveBtn = $<HTMLButtonElement>("c1-evolve"), playBtn = $<HTMLButtonElement>("c1-play"), status = $("c1-status");
  evolveBtn.onclick = () => { if (!evolveLeft) evolveLeft = 20; };
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; };
  $<HTMLButtonElement>("c1-reset").onclick = () => { w = createWorld(1, rules); follow = null; evolveLeft = 0; };
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
        (w.avgHist.length ? ` · last generation ate ${fmt(last, 1)} pellets per map on average` : "");
    evolveBtn.disabled = evolveLeft > 0;
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
  // connections
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
function drawScores(cx: CanvasRenderingContext2D, w: World): void {
  const CW = cx.canvas.width, CH = cx.canvas.height;
  cx.fillStyle = C.panel;
  cx.fillRect(0, 0, CW, CH);
  const ys = w.avgHist;
  cx.font = `12px ${FONT}`;
  cx.fillStyle = C.muted;
  cx.textAlign = "left";
  cx.textBaseline = "top";
  cx.fillText("food eaten per map, average of each generation", 8, 6);
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

// --- chapter 8: poison up the food chain -----------------------------------------------------------------------------
// Two life worlds, same seed, one difference: hunters see a glow on sick prey (left) or see nothing (right). The rules are
// the proof of 2026-11-08 (gS3 / bS3): fast hunters (hunger 0.0025, meal 0.5, the defaults then), prey-like hunter breeding,
// both eyes, full poison (dose 1).
function chapterPoison(): void {
  const base: Rules = {
    ...DEFAULT_RULES, mode: 1, hunters: 4, food: 60, foodSpread: 0.0005, regrow: 100, poison: 0.3, eye: 4, ecoWarmup: 0, birth: 0,
    senseFood2: 1, senseCreature: 1, hunterEye: 4, eyeMotion: 1, hunterMature: 0, hunterBirth: 1.2, hunterBirthChance: 1,
    hunterHunger: 0.0025, hunterMeal: 0.5,
  };
  const sides = [
    { id: "g", cue: 2, cx: $<HTMLCanvasElement>("c8-glow").getContext("2d")!, w: null as World | null },
    { id: "b", cue: 0, cx: $<HTMLCanvasElement>("c8-blind").getContext("2d")!, w: null as World | null },
  ];
  const reset = () => { for (const s of sides) s.w = createWorld(1, { ...base, hunterCue: s.cue }); };
  reset();
  let speed = 2, visible = false, skipTo = 0;
  const speedBtns = document.querySelectorAll<HTMLButtonElement>("[data-c8speed]");
  speedBtns.forEach((b) => (b.onclick = () => {
    speed = Number(b.dataset.c8speed);
    speedBtns.forEach((x) => x.classList.toggle("on", x === b));
  }));
  $<HTMLButtonElement>("c8-skip").onclick = () => { if (!skipTo) skipTo = sides[0].w!.tick + 20000; };
  $<HTMLButtonElement>("c8-reset").onclick = () => { reset(); skipTo = 0; };
  whenVisible($("ch8"), (v) => (visible = v));
  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (skipTo) {
      const t0 = performance.now();
      while (performance.now() - t0 < 16 && sides[0].w!.tick < skipTo) for (const s of sides) step(s.w!);
      if (sides[0].w!.tick >= skipTo) skipTo = 0;
    } else for (let i = 0; i < speed; i++) for (const s of sides) step(s.w!);
    for (const s of sides) {
      const w = s.w!;
      drawWorld(s.cx, w, { glow: s.cue === 2 });
      const k = w.eco.sick;
      const sickNow = w.creatures.length ? w.creatures.filter((c) => c.alive && c.toxin > SICK).length / w.creatures.length : 0;
      const pick = k.caught && k.samples ? (k.caughtSick / k.caught) / (k.sickShare / k.samples) : NaN;
      $(`c8-${s.id}-stats`).textContent =
        `prey ${w.creatures.length} · hunters ${w.hunters.length} · sick now ${Math.round(sickNow * 100)}% · ` +
        `catches ${k.caught} · pick so far ${fmt(pick)}`;
    }
    $("c8-tick").textContent = skipTo ? `Skipping ahead… tick ${sides[0].w!.tick} of ${skipTo}` : `Tick ${sides[0].w!.tick}`;
  };
  requestAnimationFrame(frame);
}

chapterBrain();
chapterPoison();

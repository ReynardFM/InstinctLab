// Instinct Lab roguelite demo. Pick a species; it runs 3 stages with a fixed generation budget each and
// keeps its brains between stages. Before stages 2 and 3 you pick one sense card; between stages you may
// change the reward sliders. A stage passes when the average of its last 4 checks reaches the species' bar.
// Creds come from cleared stages only (no luck from single checks) and buy permanent unlocks.
import { SPECIES, SENSE_INFO, World, POP, HELD, type Sense, type Stats, type Weights, type Species, type Level } from "./game/sim.ts";
import { Runner, STAGES, BUDGET, SCORE_CHECKS, stageScore, type StageStart, type Out, type Check } from "./game/runner.ts";

declare const __WORKER_SRC__: string;

// Pass bars per species and stage, tuned so the right senses pass and the wrong ones fail on >= 4 of 5 seeds
// (proto/tune-species.ts). Values are the stage score: goal value vs that species' hand-written bot.
// Measured (5 seeds, 60 generations per stage, 2026-10-29):
//   grazer    poison patch: see poison 0.40-0.92 vs taste/energy 0.19-0.28; hunted: see hunter 0.47-0.78 vs without 0.30-0.46
//   sprinter  poison patch: see poison 0.67-0.91 vs taste/energy 0.48-0.52; hunted: 0.41-0.79 on every path (it sees and outruns hunters)
//   scavenger poison patch: all paths 0.82-1.54 (see poison + avoid reward weakest); hunted: see hunter 0.42-0.79 vs without 0.26-0.43
const BARS: Record<string, number[]> = { grazer: [0.6, 0.35, 0.45], sprinter: [0.6, 0.6, 0.4], scavenger: [0.6, 1.1, 0.45] };
const GOAL_TEXT = { clean: "clean food (food minus poison)", eaten: "everything swallowed, poison included", alive: "time alive" };

// ---------- save (per browser; the page works without it) ----------
interface StageRec { build: Sense[]; weights: Weights; score: number; pass: boolean; hist: number[] }
interface RunRec { n: number; sp: number; seed: number; layers: number[]; stages: StageRec[]; creds: number; over: boolean; tutorial?: boolean }
interface Save { spent: number; owned: string[]; runs: RunRec[] }
const KEY = "instinct-lab-roguelite-v1";
const fresh = (): Save => ({ spent: 0, owned: ["species:grazer"], runs: [] });
function load(): Save { try { const s = localStorage.getItem(KEY); return s ? { ...fresh(), ...JSON.parse(s) } : fresh(); } catch { return fresh(); } }
function persist(): void { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage blocked: lasts until reload */ } }
let save = load();

// ---------- permanent unlocks ----------
interface Item { id: string; label: string; price: number; note?: string; warning?: string }
const SHOP: Item[] = [
  { id: "species:sprinter", label: "Species: Sprinter", price: 2, note: SPECIES[1].blurb },
  { id: "species:scavenger", label: "Species: Scavenger", price: 3, note: SPECIES[2].blurb },
  { id: "layers:2", label: "Brain: 2 layers of 6", price: 2,
    warning: "⚠ Bigger brain ≠ smarter. Tested: no better, sometimes slightly worse. More connections = more for evolution to search, so learning can be slower." },
];
const owns = (id: string) => save.owned.includes(id);
const earned = () => save.runs.reduce((s, r) => s + r.creds, 0);
const wallet = () => earned() - save.spent;

// ---------- state ----------
type Mode = "home" | "pick" | "running" | "result" | "summary";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let mode: Mode = "home";
let spIdx = 0;
let tutorial = true; // grazer only: guided first run (Rey 2026-10-29: tutorial + normal); Normal once a tutorial is done
// Tutorial hints per stage: the must-pick sense and why (measured in proto/tune-run.ts and tune-species.ts)
const TUTORIAL: { must: Sense | null; before: string; after: string }[] = [
  { must: null, before: "Your creatures already see the nearest food. No new sense needed: press Evolve and watch them learn to find it. The reward stays at 50 eat / 50 avoid, which is exactly this species' goal.",
    after: "Evolution kept the brains that ate the most and copied them with small changes. That alone was enough here." },
  { must: "poison", before: "Pick 'see poison'. 'See food' points at the nearest bead, poison or not. Taste only tells after the bite, and these brains can't learn during their life, so taste can't help. Feeling energy doesn't tell poison from food either.",
    after: "With 'see poison', evolution could find brains that turn away when the nearest bead is poison. Without it, they can't tell the two apart (measured: the taste pick fails on 5 of 5 seeds)." },
  { must: "hunter", before: "Pick 'see hunter'. Hunters catch creatures that don't move away. You can't flee what you can't see: the 'flee' action only works with this sense.",
    after: "Tutorial done. In Normal mode every choice is yours, including the reward: some mixes are traps, and the best mix changes with the stage." },
];
const tut = () => !!run?.tutorial;
let layers: number[] = [6];
let run: RunRec | null = null;
let stage = 0;
let pick: Sense | null = null;
let weights: Weights = { eat: 50, avoid: 50, live: 0 };
let checks: Check[] = []; // this stage
let champ: number[] | null = null;
let last: Check | null = null;
let speed: "normal" | "fast" = "normal";
let watch: "best" | "bot" = "best";

const sp = (): Species => SPECIES[run ? run.sp : spIdx];
const bar = (s = stage) => BARS[sp().id][s];
const owned = (): Sense[] => (run ? [...sp().start, ...run.stages.slice(0, stage).map((st) => st.build[st.build.length - 1]).filter((x): x is Sense => !!x && !sp().start.includes(x))] : sp().start);
const buildNow = (): Sense[] => { const o = owned(); return stage > 0 && pick ? [...o, pick] : o; };
const shares = (w: Weights) => { const s = w.eat + w.avoid + w.live || 1; return { eat: w.eat / s, avoid: w.avoid / s, live: w.live / s }; };
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------- evolution engine: worker if allowed, else on the page in ~10 ms slices (same results) ----------
type Msg = StageStart | { type: "stop" };
let send: (m: Msg) => void;
let engine = "worker";
function pageEngine(): (m: Msg) => void {
  const runner = new Runner();
  const ch = new MessageChannel();
  let current = 0, next: () => void = () => {};
  ch.port1.onmessage = () => next();
  return (m) => {
    const me = ++current;
    if (m.type === "stop") return;
    const it = runner.stage(m, onOut);
    next = () => {
      if (me !== current) return;
      const deadline = performance.now() + 10;
      while (performance.now() < deadline) if (it.next().done) return;
      ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  };
}
try {
  const w = new Worker(URL.createObjectURL(new Blob([__WORKER_SRC__], { type: "text/javascript" })));
  w.onmessage = (e: MessageEvent<Out>) => onOut(e.data);
  w.onerror = () => { if (engine !== "worker") return; engine = "page"; send = pageEngine(); if (mode === "running") startStage(); };
  send = (m) => w.postMessage(m);
} catch { engine = "page"; send = pageEngine(); }

function onOut(o: Out): void {
  if (!run || o.run !== run.n || o.stage !== stage || mode !== "running") return;
  if (o.type === "check") {
    checks.push(o); last = o; champ = o.champ;
    renderDashboard();
    $("runInfo").textContent = `generation ${o.gen} of ${BUDGET} · ${o.msPerGen.toFixed(0)} ms per generation${engine === "page" ? " (on page)" : ""}`;
    return;
  }
  const passed = o.score >= bar();
  run.stages.push({ build: buildNow(), weights: { ...weights }, score: o.score, pass: passed, hist: o.hist });
  if (!passed || stage === STAGES.length - 1) run.over = true;
  if (passed && !run.tutorial) { run.creds += 1; toast(`Stage cleared: +1 cred`); }
  if (passed && run.tutorial && stage === STAGES.length - 1 && !save.runs.some((x) => x !== run && x.tutorial && x.creds > 0)) { run.creds = 1; toast("Tutorial finished: +1 cred (once)"); }
  persist();
  mode = "result";
  renderAll();
}

// ---------- actions ----------
function startRun(): void {
  const n = save.runs.length + 1;
  const t = spIdx === 0 && tutorial;
  // the tutorial always uses seed 1: the right picks clear it with the most margin (0.92 / 0.73 vs bars 0.40 / 0.45)
  run = { n, sp: spIdx, seed: t ? 1 : n, layers: t ? [6] : layers.slice(), stages: [], creds: 0, over: false, tutorial: t };
  if (t) weights = { eat: 50, avoid: 50, live: 0 };
  save.runs.push(run);
  stage = 0; pick = null; checks = []; champ = null; last = null; watch = "best";
  mode = "pick"; persist(); renderAll();
}
function startStage(): void {
  if (!run) return;
  checks = []; last = null; champ = null; replay = null;
  mode = "running";
  send({ type: "stage", run: run.n, stage, sp: run.sp, seed: run.seed, layers: run.layers, build: buildNow(), weights: { ...weights } });
  renderAll();
}
function nextStage(): void { stage++; pick = null; mode = "pick"; replay = null; champ = null; renderAll(); }
function endRun(): void { if (run) { run.over = true; persist(); } mode = "summary"; renderAll(); }
function home(): void {
  if (run?.tutorial && run.over) tutorial = false;
  send({ type: "stop" }); run = null; stage = 0; pick = null; mode = "home"; replay = null; champ = null; checks = []; renderAll(); }
function buy(it: Item): void {
  if (owns(it.id) || wallet() < it.price) return;
  save.spent += it.price; save.owned.push(it.id); persist(); toast(`Unlocked: ${it.label}`); renderAll();
}

// ---------- the reason line ----------
function reason(s: Species, lv: Level, build: Sense[], c: Stats, b: Stats, score: number, need: number, w: Weights): string {
  if (score >= need) return score >= 1 ? "Better than the hand-written bot." : "Good enough: stage cleared.";
  const sh = shares(w);
  if (s.goal !== "alive" && sh.eat < 0.2)
    return sh.live > sh.avoid ? "Your reward pays for staying alive, not for eating, so they learned to keep away from everything."
      : "Your reward pays for not eating poison, so they learned not to eat at all.";
  if (s.goal === "eaten" && build.includes("poison") && sh.avoid >= 0.35 && lv.bad > 0)
    return "For a scavenger poison counts as food and barely hurts, but your reward punishes it, so they skip half of what they could swallow.";
  if (lv.hunters > 0 && c.hunted > b.hunted + 0.1)
    return build.includes("hunter") ? "They see hunters but haven't learned to flee well enough in time." : "Your creatures can't see hunters, so they can't learn to flee them.";
  if (s.goal !== "eaten" && lv.bad > 0 && c.bad > b.bad + 0.5) {
    if (build.includes("poison")) return sh.avoid < 0.35 ? "Your reward barely punishes poison, so they eat it even though they can see it." : "They see poison but haven't learned to avoid it well enough in time.";
    if (build.includes("taste")) return "Taste only tells after the bite. These brains can't learn during life, so taste can't help.";
    return "Your creatures can't tell poison from food, so they eat both.";
  }
  if (c.starved > b.starved + 0.1) return s.hunger > 1 ? "They starve: this fast body burns energy. A reward with more eating may help." : "They starve: they haven't learned to find food well enough.";
  return s.goal === "alive" ? "They die sooner than the bot's creatures." : "They collect less than the bot.";
}

// ---------- rendering: the right-hand panel ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
function button(label: string, onClick: () => void, cls = "", disabled = false): HTMLButtonElement { const b = el("button", cls); b.textContent = label; b.onclick = onClick; b.disabled = disabled; return b; }
function stagePills(): HTMLElement {
  const box = el("div", "stages");
  STAGES.forEach((st, i) => {
    const rec = run?.stages[i];
    const p = el("span", "stage-pill" + (rec ? (rec.pass ? " pass" : " fail") : i === stage && run ? " now" : ""));
    p.textContent = `${i + 1}. ${st.name}${rec ? ` ${rec.score.toFixed(2)}` : ""}`;
    box.appendChild(p);
  });
  return box;
}
function sliders(disabled: boolean): HTMLElement {
  const box = el("div");
  const sh = shares(weights);
  const parts: [keyof Weights, string, string][] = [["eat", "eating", "food eaten, compared with the bot"], ["avoid", "avoiding poison", "minus poison eaten, same scale"], ["live", "staying alive", "share of the round survived"]];
  for (const [k, label, help] of parts) {
    const row = el("div", "slider"), lab = el("label", "", `<span>${label} <small>${help}</small></span><b>${pct(sh[k])}</b>`);
    const r = el("input"); r.type = "range"; r.min = "0"; r.max = "100"; r.step = "5"; r.value = String(weights[k]); r.disabled = disabled;
    r.oninput = () => { weights = { ...weights, [k]: Number(r.value) }; renderPanel(); };
    lab.appendChild(r); row.appendChild(lab); box.appendChild(row);
  }
  box.appendChild(button("reset to 50 / 50 / 0", () => { weights = { eat: 50, avoid: 50, live: 0 }; renderPanel(); }, "", disabled));
  return box;
}

function renderPanel(): void {
  const P = $("panel"); P.innerHTML = "";
  const s = sp();
  if (mode === "home") {
    P.appendChild(el("h2", "", "Choose a species"));
    const ch = el("div", "choices");
    SPECIES.forEach((x, i) => {
      const open = owns(`species:${x.id}`);
      const b = el("button", "choice" + (i === spIdx ? " on" : "") + (open ? "" : " locked"), `<b>${x.name}${open ? "" : " 🔒"}</b><small>${x.blurb}</small>`);
      b.disabled = !open; b.onclick = () => { spIdx = i; replay = null; renderAll(); };
      ch.appendChild(b);
    });
    P.appendChild(ch);
    if (spIdx === 0) {
      P.appendChild(el("h2", "", "Mode"));
      const md = el("div", "choices");
      for (const [t, name, help] of [[true, "Tutorial mode", "Guided: tells you which sense is a must at each stage, and why. Pays 1 cred once."], [false, "Normal mode", "Explore: every sense and reward is your choice. 1 cred per cleared stage."]] as const) {
        const b = el("button", "choice" + (tutorial === t ? " on" : ""), `<b>${name}</b><small>${help}</small>`);
        b.onclick = () => { tutorial = t; renderPanel(); };
        md.appendChild(b);
      }
      P.appendChild(md);
    }
    P.appendChild(el("h2", "", "Brain"));
    const br = el("div", "row");
    for (const [lab, ls, need] of [["1 layer of 6", [6], ""], ["2 layers of 6", [6, 6], "layers:2"]] as const) {
      const ok = !need || owns(need);
      br.appendChild(button(lab + (ok ? "" : " 🔒"), () => { layers = [...ls]; renderPanel(); }, layers.length === ls.length ? "on" : "", !ok));
    }
    P.appendChild(br);
    const go = el("div", "row"); go.appendChild(button(`Start ${spIdx === 0 && tutorial ? "the tutorial" : "a run"} as ${s.name}`, startRun, "primary")); P.appendChild(go);
    P.appendChild(el("p", "muted", `A run is 3 stages of ${BUDGET} generations. A stage passes when the average of its last ${SCORE_CHECKS} checks reaches the bar. Each cleared stage pays 1 cred.`));
    P.appendChild(el("h2", "", "Permanent unlocks"));
    for (const it of SHOP) {
      const row = el("div", "shop-item"), left = el("div", "", `<div>${it.label}</div>` + (it.note ? `<small class="muted">${it.note}</small>` : "") + (it.warning ? `<div class="warning">${it.warning}</div>` : ""));
      row.append(left, owns(it.id) ? button("owned ✓", () => {}, "", true) : button(`buy ${it.price}`, () => buy(it), "", wallet() < it.price));
      P.appendChild(row);
    }
    P.appendChild(el("div", "row")).appendChild(button("Reset all progress", () => { save = fresh(); persist(); spIdx = 0; layers = [6]; renderAll(); }));
    return;
  }
  const lv = STAGES[stage];
  P.appendChild(el("h2", "", `${s.name}${tut() ? " · tutorial" : ""} · run ${run!.n} · seed ${run!.seed}`));
  P.appendChild(stagePills());
  P.appendChild(el("h3", "", `Stage ${stage + 1}: ${lv.name}`));
  P.appendChild(el("p", "", `${lv.blurb} Goal: ${GOAL_TEXT[s.goal]}. Pass: ${bar()} of the hand-written bot, averaged over the last ${SCORE_CHECKS} checks.`));
  if (mode === "pick") {
    const have = owned();
    P.appendChild(el("p", "muted", `Senses: food${have.length ? " + " + have.join(" + ") : ""}.`));
    if (tut()) P.appendChild(el("div", "reason", "💡 " + TUTORIAL[stage].before));
    if (stage > 0) {
      P.appendChild(el("h2", "", "Pick one new sense"));
      const ch = el("div", "choices");
      for (const x of lv.menu.filter((m) => !have.includes(m))) {
        const [nm, ...rest] = SENSE_INFO[x].split(": ");
        const locked = tut() && x !== TUTORIAL[stage].must;
        const b = el("button", "choice" + (pick === x ? " on" : "") + (locked ? " locked" : ""), `<b>${nm}${locked ? " (try it in Normal)" : ""}</b><small>${rest.join(": ")}</small>`);
        b.disabled = locked;
        b.onclick = () => { pick = x; renderPanel(); };
        ch.appendChild(b);
      }
      P.appendChild(ch);
    }
    P.appendChild(el("h2", "", "Reward: what evolution scores"));
    if (tut()) P.appendChild(el("p", "muted", "Locked at 50 eat / 50 avoid in the tutorial: that is exactly the grazer's goal. In Normal you can change it."));
    P.appendChild(sliders(tut()));
    const row = el("div", "row");
    row.appendChild(button(`Evolve ${BUDGET} generations`, startStage, "primary", stage > 0 && !pick));
    row.appendChild(button("Quit run", () => { endRun(); }));
    P.appendChild(row);
    return;
  }
  if (mode === "running") {
    P.appendChild(el("p", "", `Senses: food + ${buildNow().join(" + ") || "nothing else"}.`));
    P.appendChild(el("div", "reason", "Evolving…"));
    P.appendChild(el("p", "muted")).id = "runInfo";
    P.appendChild(el("div", "row")).appendChild(button("Quit run", () => { send({ type: "stop" }); endRun(); }));
    return;
  }
  if (mode === "result") {
    const rec = run!.stages[stage];
    P.appendChild(el("div", "verdict " + (rec.pass ? "pass" : "fail"), rec.pass ? `Cleared: ${rec.score.toFixed(2)} ≥ ${bar()}` : `Failed: ${rec.score.toFixed(2)} < ${bar()}`));
    if (last) P.appendChild(el("div", "reason", reason(s, lv, rec.build, last.champStats, last.ruleStats, rec.score, bar(), rec.weights)));
    if (tut() && rec.pass) P.appendChild(el("p", "", "💡 " + TUTORIAL[stage].after));
    const row = el("div", "row");
    if (rec.pass && stage < STAGES.length - 1) row.appendChild(button("Next stage", nextStage, "primary"));
    else row.appendChild(button("See run summary", () => { mode = "summary"; renderAll(); }, "primary"));
    if (rec.pass && stage < STAGES.length - 1) row.appendChild(button("Quit run", () => endRun()));
    P.appendChild(row);
    return;
  }
  // summary
  const cleared = run!.stages.filter((x) => x.pass).length;
  P.appendChild(el("div", "verdict " + (cleared === STAGES.length ? "pass" : "fail"), cleared === STAGES.length ? "Run complete: all stages cleared" : `Run over: ${cleared} of ${STAGES.length} stages cleared`));
  P.appendChild(el("p", "", `Creds earned: ${run!.creds}. Same species, seed and choices always give the same run.`));
  const row = el("div", "row");
  if (run!.tutorial) row.appendChild(button("Start a Normal run", () => { home(); spIdx = 0; tutorial = false; startRun(); }, "primary"));
  row.appendChild(button("Back to start", home, run!.tutorial ? "" : "primary"));
  P.appendChild(row);
}

// ---------- rendering: dashboard ----------
function css(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function renderDashboard(): void {
  $("tStage").textContent = run ? `${stage + 1} / ${STAGES.length}` : "-";
  $("tGen").textContent = last ? `${last.gen} / ${BUDGET}` : "-";
  $("tScore").textContent = checks.length ? stageScore(checks.map((c) => c.progress)).toFixed(2) : run?.stages[stage] ? run.stages[stage].score.toFixed(2) : "-";
  $("tBar").textContent = run || mode === "home" ? String(bar()) : "-";
  drawChart();
  const tb = $("runs"); tb.innerHTML = "";
  for (const r of [...save.runs].reverse()) {
    const tr = document.createElement("tr");
    const senses = r.stages.length ? r.stages[r.stages.length - 1].build.join(" + ") || "food only" : "-";
    const cells = [String(r.n), SPECIES[r.sp].name + (r.tutorial ? " (tutorial)" : ""), String(r.seed), senses, r.stages.map((x) => x.score.toFixed(2) + (x.pass ? "" : "✗")).join("  "), `${r.stages.filter((x) => x.pass).length}/${STAGES.length}${r.over ? "" : " …"}`, String(r.creds)];
    for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); }
    tb.appendChild(tr);
  }
}
function drawChart(): void {
  const cv = $("chart") as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const L = 40, R = 12, T = 10, B = 26, total = BUDGET * STAGES.length, maxY = 1.4;
  const X = (gen: number) => L + (gen / total) * (W - L - R), Y = (v: number) => T + (1 - Math.max(0, Math.min(maxY, v)) / maxY) * (H - T - B);
  g.font = "11px system-ui, sans-serif"; g.lineWidth = 1;
  for (const v of [0, 0.5, 1]) { g.strokeStyle = css("--line"); g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.fillStyle = css("--muted"); g.fillText(v.toFixed(1), 8, Y(v) + 4); }
  STAGES.forEach((st, i) => {
    const x0 = X(i * BUDGET), x1 = X((i + 1) * BUDGET);
    g.fillStyle = css("--muted"); g.fillText(st.name, x0 + 4, H - 8);
    if (i) { g.strokeStyle = css("--line"); g.beginPath(); g.moveTo(x0, T); g.lineTo(x0, H - B); g.stroke(); }
    g.setLineDash([5, 4]); g.strokeStyle = css("--warn"); g.beginPath(); g.moveTo(x0, Y(bar(i))); g.lineTo(x1, Y(bar(i))); g.stroke(); g.setLineDash([]);
    const hist = run?.stages[i]?.hist ?? (i === stage && checks.length ? checks.map((c) => c.progress) : null);
    if (!hist) return;
    const pts = (h: number[]) => h.map((v, k) => [X(i * BUDGET + (k + 1) * 5), Y(v)] as const);
    g.strokeStyle = "rgba(43,92,158,.3)"; g.lineWidth = 1.5; g.beginPath(); pts(hist).forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    const avg = hist.map((_, k) => stageScore(hist.slice(0, k + 1)));
    g.strokeStyle = css("--accent"); g.lineWidth = 2.5; g.beginPath(); pts(avg).forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  });
  g.fillStyle = css("--muted"); g.fillText("thick: average of last 4 checks · faint: single checks · dashed: pass bar", L + 4, T + 10);
}

// ---------- rendering: world replay ----------
let replay: World | null = null, replayOf: "best" | "bot" = "bot", lastFrame = performance.now(), owed = 0;
function nextReplay(): World {
  const lv = STAGES[stage], s = sp();
  if (watch === "best" && champ) { replayOf = "best"; return new World(lv, false, buildNow(), run ? run.layers : layers, Array.from({ length: POP }, () => champ!), HELD[0], s); }
  replayOf = "bot";
  return new World(lv, true, [], [], Array.from({ length: POP }, () => []), HELD[0], s);
}
function drawWorld(w: World): void {
  const cv = $("world") as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1, S = cv.clientWidth || 400;
  if (cv.width !== Math.round(S * dpr)) { cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr); }
  const g = cv.getContext("2d")!;
  g.setTransform((S * dpr) / 400, 0, 0, (S * dpr) / 400, 0, 0);
  g.fillStyle = css("--field"); g.fillRect(0, 0, 400, 400);
  for (let f = 0; f < w.fx.length; f++) {
    g.beginPath(); g.arc(w.fx[f], w.fy[f], 3.2, 0, Math.PI * 2);
    g.fillStyle = w.bad[f] ? css("--poison") : css("--food"); g.fill();
    if (!w.bad[f]) { g.strokeStyle = css("--food-rim"); g.lineWidth = 1; g.stroke(); }
  }
  const colors = [css("--eat"), css("--avoid"), css("--flee"), css("--wander")];
  for (let i = 0; i < w.px.length; i++) {
    if (!w.alive[i]) continue;
    g.fillStyle = colors[w.act[i]]; g.beginPath(); g.arc(w.px[i], w.py[i], 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = colors[w.act[i]]; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w.px[i], w.py[i]); g.lineTo(w.px[i] + w.hx[i] * 9, w.py[i] + w.hy[i] * 9); g.stroke();
  }
  g.fillStyle = css("--hunter");
  for (let h = 0; h < w.kx.length; h++) {
    const x = w.kx[h], y = w.ky[h], dx = w.kdx[h], dy = w.kdy[h];
    g.beginPath(); g.moveTo(x + dx * 9, y + dy * 9); g.lineTo(x - dx * 6 - dy * 6, y - dy * 6 + dx * 6); g.lineTo(x - dx * 6 + dy * 6, y - dy * 6 - dx * 6); g.closePath(); g.fill();
  }
  const alive = w.alive.filter(Boolean).length;
  $("watchTitle").textContent = `${replayOf === "best" ? `Best brain (generation ${last?.gen ?? 0})` : "Hand-written bot"} · ${STAGES[stage].name} · tick ${w.t}/800 · alive ${alive}/${POP}`;
}
function frame(): void {
  const want = watch === "best" && champ ? "best" : "bot";
  if (!replay || replay.done || replayOf !== want) replay = nextReplay();
  const now = performance.now(), dt = Math.min(100, now - lastFrame);
  owed += (dt / 1000) * (speed === "fast" ? 960 : 240);
  for (; owed >= 1 && !replay.done; owed--) replay.step();
  lastFrame = now;
  drawWorld(replay);
  $("watchNote").textContent = want === "bot" ? "Showing the hand-written bot on a map evolution never trains on. Once a stage runs, the best brain so far plays here." : "The best brain so far plays a map it never trained on.";
  requestAnimationFrame(frame);
}

// ---------- misc ----------
let toastTimer = 0;
function toast(msg: string): void { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800); }
function renderAll(): void { $("wallet").textContent = `Creds: ${wallet()}`; renderPanel(); renderDashboard(); }
$("watchBest").onclick = () => { watch = "best"; $("watchBest").className = "on"; $("watchBot").className = ""; replay = null; };
$("watchBot").onclick = () => { watch = "bot"; $("watchBot").className = "on"; $("watchBest").className = ""; replay = null; };
$("speed").onclick = () => { speed = speed === "normal" ? "fast" : "normal"; $("speed").textContent = speed; };
window.addEventListener("resize", () => renderDashboard());
for (const r of save.runs) r.over = true; // a run left open by a closed tab counts as finished
if (save.runs.some((x) => x.tutorial && x.stages.length === STAGES.length && x.stages.every((st) => st.pass))) tutorial = false;
renderAll();
requestAnimationFrame(frame);

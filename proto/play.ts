// Learning-game page (prototype). Player picks senses, evolution runs in a worker, the page replays the
// best brain, pays creds for new best progress, and keeps a dashboard of attempts.
import { LEVELS, SENSE_INFO, World, Evolver, POP, HELD, BAR, why, type Sense, type Stats } from "./game/sim.ts";
import type { Check, Start } from "./game/worker.ts";

declare const __WORKER_SRC__: string;

// ---------- save (per browser; the page works without it) ----------
interface Attempt { n: number; level: number; build: Sense[]; layers: number[]; gens: number; best: number; earned: number; hist: number[] }
interface Save { high: Record<string, number>; spent: number; owned: string[]; attempts: Attempt[] }
const KEY = "evolution-lab-learning-game-v1";
const fresh = (): Save => ({ high: {}, spent: 0, owned: ["level:L1", "sense:taste", "sense:energy"], attempts: [] });
function load(): Save { try { const s = localStorage.getItem(KEY); return s ? { ...fresh(), ...JSON.parse(s) } : fresh(); } catch { return fresh(); } }
function persist(): void { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage blocked: progress lasts until reload */ } }
let save = load();

// ---------- shop ----------
interface Item { id: string; label: string; price: number; warning?: string }
const SHOP: Item[] = [
  { id: "sense:poison", label: "Sense: see poison", price: 0.3 },
  { id: "level:L2", label: "Level 2: Hunted", price: 0.6 },
  { id: "sense:hunter", label: "Sense: see hunter", price: 0.3 },
  { id: "slot:3", label: "Extra slot (3 senses)", price: 1.5 },
  { id: "layers:2", label: "More layers: 2 layers of 6", price: 0.5,
    warning: "⚠ Bigger brain ≠ smarter. Tested on these levels: no better, sometimes slightly worse. More connections = more for evolution to search, so learning can be slower." },
];
const owns = (id: string) => save.owned.includes(id);
const earnedTotal = () => Object.values(save.high).reduce((s, x) => s + x, 0);
const wallet = () => earnedTotal() - save.spent;
const slots = () => (owns("slot:3") ? 3 : 2);

// ---------- page state ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let level = 0;
let chosen = new Set<Sense>();
let layers: number[] = [6];
let speed: "normal" | "fast" = "normal";
let watch: "best" | "bot" = "best";
let running: Attempt | null = null;
let champ: number[] | null = null; // best brain of the current/last attempt
let bestStats: { c: Stats; b: Stats; p: number } | null = null;
let lastGen = 0;
let champGen = 0; // generation of the brain being replayed

// Evolution engine: a Web Worker when the browser allows one. Some previews (sandboxed frames) block
// Blob workers; then evolution runs on the page itself, one generation per timer tick (same results).
type Msg = Start | { type: "stop" };
let lastStart: Start | null = null;
function pageEngine(): (m: Msg) => void {
  let run = 0;
  const ch = new MessageChannel(); // yields without setTimeout's 4 ms minimum
  let next: () => void = () => {};
  ch.port1.onmessage = () => next();
  return (m) => {
    const me = ++run;
    if (m.type === "stop") return;
    const ev = new Evolver(LEVELS[m.level], m.build, m.layers, m.seed);
    let it: Generator<void, number | null> | null = null;
    let busy = 0, gens = 0;
    next = () => {
      if (me !== run) return;
      // ~10 ms of evolution per slice, then hand the page back so drawing stays smooth
      const t0 = performance.now(), deadline = t0 + 10;
      while (performance.now() < deadline) {
        if (!it) it = ev.generation();
        const r = it.next();
        if (!r.done) continue;
        it = null; gens++;
        if (r.value !== null) {
          busy += performance.now() - t0;
          onCheck({ type: "check", attempt: m.attempt, gen: ev.gen, progress: r.value, champ: ev.champ!, champStats: ev.champStats!, ruleStats: ev.ruleStats, msPerGen: busy / gens });
          busy = 0; gens = 0;
          break;
        }
      }
      busy += performance.now() - t0;
      ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  };
}
let send: (m: Msg) => void;
let engine = "worker";
try {
  const w = new Worker(URL.createObjectURL(new Blob([__WORKER_SRC__], { type: "text/javascript" })));
  w.onmessage = (e: MessageEvent<Check>) => onCheck(e.data);
  w.onerror = () => { // blocked after construction: switch over and restart the running attempt
    if (engine !== "worker") return;
    engine = "page"; send = pageEngine();
    if (running && lastStart) send(lastStart);
  };
  send = (m) => w.postMessage(m);
} catch {
  engine = "page"; send = pageEngine();
}
function onCheck(m: Check): void {
  if (!running || m.attempt !== running.n) return; // a check from a run that was stopped
  const a = running;
  a.hist.push(m.progress);
  a.gens = m.gen;
  lastGen = m.gen;
  if (m.progress > a.best) { a.best = m.progress; champ = m.champ; champGen = m.gen; bestStats = { c: m.champStats, b: m.ruleStats, p: m.progress }; }
  const id = LEVELS[a.level].id, old = save.high[id] ?? 0;
  if (m.progress > old) { // creds = new best progress on this level only (any rise would be farmable)
    save.high[id] = m.progress;
    a.earned += m.progress - old;
    toast(`New best ${m.progress.toFixed(2)}: +${(m.progress - old).toFixed(2)} creds`);
  }
  $("runInfo").textContent = `running · ${m.msPerGen.toFixed(0)} ms per generation${engine === "page" ? " (on page)" : ""}`;
  persist();
  renderDashboard();
  renderTop();
}

// ---------- actions ----------
function start(): void {
  if (running) return;
  const build = LEVELS[level].menu.filter((s) => chosen.has(s)); // menu order = input order
  running = { n: save.attempts.length + 1, level, build, layers: layers.slice(), gens: 0, best: -Infinity, earned: 0, hist: [] };
  save.attempts.push(running);
  champ = null; bestStats = null; lastGen = 0;
  lastStart = { type: "start", attempt: running.n, level, build, layers: running.layers, seed: running.n };
  send(lastStart);
  $("runInfo").textContent = "starting…";
  watch = "best"; replay = null;
  renderAll();
}
function stop(): void {
  if (!running) return;
  send({ type: "stop" });
  running = null;
  $("runInfo").textContent = "";
  persist();
  renderAll();
}
function buy(it: Item): void {
  if (owns(it.id) || wallet() < it.price - 1e-9) return;
  save.spent += it.price;
  save.owned.push(it.id);
  persist();
  toast(`Unlocked: ${it.label}`);
  renderAll();
}

// ---------- rendering: controls ----------
function renderTop(): void { $("wallet").textContent = `Creds: ${wallet().toFixed(2)}`; }

function renderControls(): void {
  const busy = running !== null;
  const lv = LEVELS[level];
  const tabs = $("levels"); tabs.innerHTML = "";
  LEVELS.forEach((L, i) => {
    const b = document.createElement("button");
    const open = owns(`level:${L.id}`);
    b.textContent = `${i + 1}. ${L.name}${open ? "" : " 🔒"}`;
    b.className = i === level ? "on" : "";
    b.disabled = busy || !open;
    b.onclick = () => { level = i; chosen = new Set([...chosen].filter((s) => LEVELS[i].menu.includes(s))); champ = null; bestStats = null; replay = null; renderAll(); };
    tabs.appendChild(b);
  });
  $("blurb").textContent = `${lv.blurb} Goal: reach ${BAR} of the hand-written bot's score on maps your creatures never trained on.`;
  $("slotCount").textContent = `(${chosen.size} of ${slots()} slots)`;
  const box = $("senses"); box.innerHTML = "";
  for (const s of lv.menu) {
    const have = owns(`sense:${s}`);
    const row = document.createElement("label");
    row.className = "sense" + (have ? "" : " locked");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = chosen.has(s);
    cb.disabled = busy || !have || (!chosen.has(s) && chosen.size >= slots());
    cb.onchange = () => { if (cb.checked) chosen.add(s); else chosen.delete(s); renderControls(); };
    const [nm, ...rest] = SENSE_INFO[s].split(": ");
    const txt = document.createElement("div");
    txt.innerHTML = `${nm}${have ? "" : " 🔒 <span class='muted'>(shop)</span>"} <small>${rest.join(": ")}</small>`;
    row.append(cb, txt);
    box.appendChild(row);
  }
  const br = $("brains"); br.innerHTML = "";
  for (const [lab, ls, need] of [["1 layer of 6", [6], ""], ["2 layers of 6", [6, 6], "layers:2"]] as const) {
    const b = document.createElement("button");
    const ok = !need || owns(need);
    b.textContent = lab + (ok ? "" : " 🔒");
    b.className = layers.length === ls.length ? "on" : "";
    b.disabled = busy || !ok;
    b.onclick = () => { layers = [...ls]; renderControls(); };
    br.appendChild(b);
  }
  ($("go") as HTMLButtonElement).disabled = busy;
  ($("stop") as HTMLButtonElement).disabled = !busy;
  const shop = $("shop"); shop.innerHTML = "";
  for (const it of SHOP) {
    const row = document.createElement("div"); row.className = "shop-item";
    const left = document.createElement("div");
    left.innerHTML = `<div>${it.label}</div>` + (it.warning ? `<div class="warning">${it.warning}</div>` : "");
    const b = document.createElement("button");
    if (owns(it.id)) { b.textContent = "owned ✓"; b.disabled = true; }
    else { b.textContent = `buy ${it.price.toFixed(2)}`; b.disabled = wallet() < it.price - 1e-9; b.onclick = () => buy(it); }
    row.append(left, b);
    shop.appendChild(row);
  }
  $("watchBest").className = watch === "best" ? "on" : "";
  $("watchBot").className = watch === "bot" ? "on" : "";
  $("speed").textContent = speed;
}

// ---------- rendering: dashboard ----------
function renderDashboard(): void {
  const a = running ?? [...save.attempts].reverse().find((x) => x.level === level) ?? null;
  const id = LEVELS[level].id;
  $("tGen").textContent = String(a ? a.gens : 0);
  $("tProg").textContent = a && a.hist.length ? a.best.toFixed(2) : "-";
  $("tLatest").textContent = a && a.hist.length ? `(latest check ${a.hist[a.hist.length - 1].toFixed(2)})` : "";
  $("tBest").textContent = save.high[id] !== undefined ? save.high[id].toFixed(2) : "-";
  $("tEarn").textContent = (a ? a.earned : 0).toFixed(2);
  const lv = LEVELS[level];
  if (bestStats && a) $("reason").textContent = why(lv, a.build, bestStats.c, bestStats.b, bestStats.p);
  else if (!a) $("reason").textContent = `Pick up to ${slots()} senses and press Evolve.`;
  drawChart(a);
  const tb = $("attempts"); tb.innerHTML = "";
  for (const x of [...save.attempts].reverse()) {
    const tr = document.createElement("tr");
    const cells = [String(x.n), LEVELS[x.level].name, ["food", ...x.build].join(" + "), x.layers.join("+") + " neurons",
      String(x.gens) + (x === running ? " …" : ""), Number.isFinite(x.best) ? x.best.toFixed(2) : "-", x.earned.toFixed(2)];
    for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); }
    tb.appendChild(tr);
  }
}

function css(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawChart(cur: Attempt | null): void {
  const cv = $("chart") as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const same = save.attempts.filter((x) => x.level === level);
  const maxGen = Math.max(50, ...same.map((x) => x.hist.length * 5));
  const maxY = Math.max(1.2, ...same.flatMap((x) => x.hist));
  const L = 40, R = 12, Tp = 10, B = 26;
  const X = (gen: number) => L + (gen / maxGen) * (W - L - R);
  const Y = (v: number) => Tp + (1 - Math.max(0, v) / maxY) * (H - Tp - B);
  g.font = "11px system-ui, sans-serif"; g.fillStyle = css("--muted"); g.strokeStyle = css("--line"); g.lineWidth = 1;
  for (const v of [0, 0.5, 1]) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.fillText(v.toFixed(1), 8, Y(v) + 4); }
  g.fillText("generation", W - R - 60, H - 6); g.fillText("0", L, H - 6); g.fillText(String(maxGen), W - R - 60 - g.measureText(String(maxGen)).width - 8, H - 6);
  // pass line and bot line
  g.setLineDash([5, 4]); g.strokeStyle = css("--muted");
  g.beginPath(); g.moveTo(L, Y(BAR)); g.lineTo(W - R, Y(BAR)); g.stroke(); g.fillText("pass", W - R - 28, Y(BAR) - 4); g.fillText("= bot", W - R - 34, Y(1) - 4);
  // level best (creds line)
  const hi = save.high[LEVELS[level].id];
  if (hi !== undefined) { g.strokeStyle = css("--good"); g.beginPath(); g.moveTo(L, Y(hi)); g.lineTo(W - R, Y(hi)); g.stroke(); g.fillStyle = css("--good"); g.fillText(`level best ${hi.toFixed(2)}`, L + 4, Y(hi) - 4); }
  g.setLineDash([]);
  const line = (h: number[], color: string, width: number) => {
    if (!h.length) return;
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    h.forEach((v, i) => (i ? g.lineTo(X((i + 1) * 5), Y(v)) : g.moveTo(X(5), Y(v))));
    g.stroke();
  };
  for (const x of same) if (x !== cur) line(x.hist, "rgba(93,108,112,.35)", 1.5);
  if (cur) {
    // each check measures a different brain, so it jumps around; the step line is what the player keeps
    line(cur.hist, "rgba(43,92,158,.35)", 1.5);
    let b = -Infinity; line(cur.hist.map((v) => (b = Math.max(b, v))), css("--accent"), 2.5);
  }
}

// ---------- rendering: world replay ----------
let replay: World | null = null;
let replayOf: "best" | "bot" = "best";
let lastFrame = performance.now(), owed = 0;
function nextReplay(): World | null {
  const lv = LEVELS[level];
  if (watch === "best" && champ) {
    const a = running ?? save.attempts[save.attempts.length - 1];
    replayOf = "best";
    return new World(lv, false, a.build, a.layers, Array.from({ length: POP }, () => champ!), HELD[0]);
  }
  replayOf = "bot";
  return new World(lv, true, [], [], Array.from({ length: POP }, () => []), HELD[0]);
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
    g.fillStyle = colors[w.act[i]];
    g.beginPath(); g.arc(w.px[i], w.py[i], 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = colors[w.act[i]]; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w.px[i], w.py[i]); g.lineTo(w.px[i] + w.hx[i] * 9, w.py[i] + w.hy[i] * 9); g.stroke();
  }
  g.fillStyle = css("--hunter");
  for (let h = 0; h < w.kx.length; h++) {
    const x = w.kx[h], y = w.ky[h], dx = w.kdx[h], dy = w.kdy[h];
    g.beginPath(); g.moveTo(x + dx * 9, y + dy * 9); g.lineTo(x - dx * 6 - dy * 6, y - dy * 6 + dx * 6); g.lineTo(x - dx * 6 + dy * 6, y - dy * 6 - dx * 6); g.closePath(); g.fill();
  }
  const alive = w.alive.filter(Boolean).length;
  const score = w.st.reduce((s, x) => s + x.score, 0) / w.st.length;
  $("watchTitle").textContent = `${replayOf === "best" ? `Best brain (from generation ${champGen})` : "Hand-written bot"} · tick ${w.t}/800 · alive ${alive}/${POP} · score ${score.toFixed(1)}`;
}
function frame(): void {
  if (!replay || replay.done || (watch === "best" && replayOf === "bot" && champ) || (watch === "bot" && replayOf === "best")) replay = nextReplay();
  if (replay) {
    // ticks by elapsed time (240/s normal, 960/s fast), so a busy page slows the picture, not the replay
    const now = performance.now(), dt = Math.min(100, now - lastFrame);
    owed += (dt / 1000) * (speed === "fast" ? 960 : 240);
    for (; owed >= 1 && !replay.done; owed--) replay.step();
    lastFrame = now;
    drawWorld(replay);
  }
  $("watchNote").textContent = watch === "best" && !champ ? "No brain yet: showing the hand-written bot. Press Evolve." : "Replays a map your creatures never trained on. A new replay starts with the newest best brain.";
  requestAnimationFrame(frame);
}

// ---------- misc ----------
let toastTimer = 0;
function toast(msg: string): void {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
}
function renderAll(): void { renderTop(); renderControls(); renderDashboard(); }

$("go").onclick = start;
$("stop").onclick = stop;
$("watchBest").onclick = () => { watch = "best"; replay = null; renderControls(); };
$("watchBot").onclick = () => { watch = "bot"; replay = null; renderControls(); };
$("speed").onclick = () => { speed = speed === "normal" ? "fast" : "normal"; renderControls(); };
$("reset").onclick = () => { if (running) stop(); save = fresh(); persist(); level = 0; chosen.clear(); layers = [6]; champ = null; bestStats = null; replay = null; renderAll(); };
window.addEventListener("resize", () => renderDashboard());
// an attempt left "running" by a closed tab is just finished
for (const a of save.attempts) if (!Number.isFinite(a.best)) a.best = -Infinity;
renderAll();
requestAnimationFrame(frame);

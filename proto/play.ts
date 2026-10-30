// Instinct Lab roguelite demo v2 (Rey 2026-10-29). The culture plate fills the screen; everything you choose
// is a glass slide. A run: pick a species, then 3 stages of 60 generations. Before each stage you draft one
// card (a sense or a body change with a cost); before stages 2 and 3 you also pick a route (an event).
// During a stage the score climbs around the plate's rim; DNA drops as it nears the bar and buys powers that
// change only the training world. A stage passes when the average of its last 4 checks reaches the bar.
import { SPECIES, CARD_INFO, BODY_CARDS, EVENTS, POWERS, World, POP, HELD, makeBody, type Sense, type Stats, type Weights, type Species, type Card, type BodyCard, type EventId, type Power, type Level } from "./game/sim.ts";
import { Runner, STAGES, BUDGET, SCORE_CHECKS, stageScore, stageLevel, type In, type Out, type Check } from "./game/runner.ts";
import { createRng } from "../src/engine/rng.ts";

declare const __WORKER_SRC__: string;

// Pass bars per species and stage (proto/tune-species.ts; per-event values come from proto/tune-v2.ts).
const BARS: Record<string, number[]> = { grazer: [0.6, 0.35, 0.45], sprinter: [0.6, 0.6, 0.4], scavenger: [0.6, 1.1, 0.45] };
const GOAL_TEXT = { clean: "clean food: food minus poison", eaten: "everything swallowed, poison included", alive: "time alive" };
const SENSES: Sense[] = ["poison", "taste", "hunter", "energy", "neighbour"]; // input order
const ALL_CARDS: Card[] = [...SENSES, ...BODY_CARDS];
const DNA_MARKS = [0.25, 0.5, 0.75]; // share of the bar: each mark passed drops 1 DNA
const HARD_ROUTE_DNA = 1;
const isBody = (c: Card): c is BodyCard => (BODY_CARDS as Card[]).includes(c);

// ---------- save (per browser; the page works without it) ----------
interface StageRec { event: EventId; card: Card | null; build: Sense[]; body: BodyCard[]; weights: Weights; score: number; pass: boolean; hist: number[]; powers: { power: Power; gen: number }[] }
interface RunRec { n: number; sp: number; seed: number; layers: number[]; stages: StageRec[]; creds: number; over: boolean; tutorial?: boolean; score: number }
interface Save { spent: number; owned: string[]; runs: RunRec[] }
const KEY = "instinct-lab-roguelite-v2";
const fresh = (): Save => ({ spent: 0, owned: ["species:grazer"], runs: [] });
function load(): Save { try { const s = localStorage.getItem(KEY); return s ? { ...fresh(), ...JSON.parse(s) } : fresh(); } catch { return fresh(); } }
function persist(): void { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage blocked: lasts until reload */ } }
let save = load();
for (const r of save.runs) r.over = true; // a run left open by a closed tab counts as finished

interface Item { id: string; label: string; price: number; note?: string; warning?: string }
const SHOP: Item[] = [
  { id: "species:sprinter", label: "Sprinter", price: 2, note: SPECIES[1].blurb },
  { id: "species:scavenger", label: "Scavenger", price: 3, note: SPECIES[2].blurb },
  { id: "layers:2", label: "Brain with 2 layers", price: 2, warning: "⚠ Bigger brain ≠ smarter. Tested: no better, sometimes slightly worse. More connections = more for evolution to search, so learning can be slower." },
];
const owns = (id: string) => save.owned.includes(id);
const wallet = () => save.runs.reduce((s, r) => s + r.creds, 0) - save.spent;

// ---------- tutorial (grazer only) ----------
const TUTORIAL = [
  { offer: [] as Card[], must: null as Card | null, before: "Your creatures already see the nearest food. Press Evolve and watch the rim fill as they learn to find it.", after: "Evolution kept the creatures that ate most and copied them with small changes. That alone was enough here." },
  { offer: ["poison", "taste", "energy"] as Card[], must: "poison" as Card, before: "Pick See poison. 'See food' points at the nearest bead, poison or not. Taste only tells after the bite, and these brains can't learn during their life.", after: "With See poison, evolution found brains that turn away when the nearest bead is poison." },
  { offer: ["hunter", "legs", "belly"] as Card[], must: "hunter" as Card, before: "Pick See hunter. You can't flee what you can't see: the flee action only works with this sense. During the stage, try a power: Shelter lets them learn to eat before the hunters arrive.", after: "Tutorial done. In Normal runs the cards are drawn at random, you pick a route before stages 2 and 3, and the reward is yours to set." },
];

// ---------- state ----------
type Mode = "home" | "route" | "draft" | "running" | "result" | "summary" | "unlocks" | "history";
const $ = (id: string) => document.getElementById(id)!;
let mode: Mode = "home";
let spIdx = 0;
let tutorialMode = !save.runs.some((x) => x.tutorial && x.stages.length === 3 && x.stages.every((s) => s.pass));
let layers: number[] = [6];
let run: RunRec | null = null;
let stage = 0;
let routes: EventId[] = [];
let event: EventId = "calm";
let offer: Card[] = [];
let pick: Card | null = null;
let weights: Weights = { eat: 50, avoid: 50, live: 0 };
let dna = 0;
let marks = 0; // DNA marks passed this stage
let checks: Check[] = [];
let last: Check | null = null;
let champ: number[] | null = null;
let stagePowers: { power: Power; gen: number; until: number }[] = [];

const sp = (): Species => SPECIES[run ? run.sp : spIdx];
const bar = (s = stage) => BARS[sp().id][s];
const tut = () => !!run?.tutorial;
const ownedCards = (): Card[] => [...sp().start, ...(run ? run.stages.map((x) => x.card).filter((c): c is Card => !!c) : [])];
const cardsNow = (): Card[] => [...ownedCards(), ...(pick ? [pick] : [])];
const buildNow = (): Sense[] => SENSES.filter((s) => cardsNow().includes(s));
const bodyNow = (): BodyCard[] => cardsNow().filter(isBody);
const shares = (w: Weights) => { const s = w.eat + w.avoid + w.live || 1; return { eat: w.eat / s, avoid: w.avoid / s, live: w.live / s }; };
const lvNow = (): Level => stageLevel(stage, event);
const scoreNow = () => (checks.length ? stageScore(checks.map((c) => c.progress)) : 0);

// ---------- evolution engine: worker if allowed, else on the page in ~10 ms slices (same results) ----------
let send: (m: In) => void;
let engine = "worker";
function pageEngine(): (m: In) => void {
  const runner = new Runner();
  const ch = new MessageChannel();
  let current = 0, next: () => void = () => {};
  ch.port1.onmessage = () => next();
  return (m) => {
    if (m.type === "power") { runner.queue(m); return; }
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
    const sc = scoreNow(), before = marks;
    while (marks < DNA_MARKS.length && sc >= DNA_MARKS[marks] * bar()) marks++;
    if (marks > before) { dna += marks - before; toast(`+${marks - before} DNA`); }
    if (sc >= bar() && stageScore(checks.slice(0, -1).map((c) => c.progress)) < bar()) pulse = 1;
    renderHud();
    return;
  }
  if (o.type === "powered") { stagePowers.push({ power: o.power, gen: o.gen, until: o.until }); toast(`${POWERS[o.power].name} from generation ${o.gen}`); renderHud(); return; }
  const passed = o.score >= bar();
  const hard = EVENTS[event].hard && stage > 0;
  run.stages.push({ event, card: pick, build: buildNow(), body: bodyNow(), weights: { ...weights }, score: o.score, pass: passed, hist: o.hist, powers: stagePowers.map(({ power, gen }) => ({ power, gen })) });
  run.score += o.score * (hard ? 1.5 : 1);
  if (passed && !run.tutorial) run.creds += 1;
  if (passed && run.tutorial && stage === 2 && !save.runs.some((x) => x !== run && x.tutorial && x.creds > 0)) run.creds = 1;
  if (!passed || stage === STAGES.length - 1) run.over = true;
  persist();
  mode = "result";
  renderAll();
}

// ---------- actions ----------
function startRun(seed?: number): void {
  const n = save.runs.length + 1, t = spIdx === 0 && tutorialMode;
  run = { n, sp: spIdx, seed: seed ?? (t ? 1 : n), layers: t ? [6] : layers.slice(), stages: [], creds: 0, over: false, tutorial: t, score: 0 };
  save.runs.push(run); persist();
  stage = 0; dna = 0; weights = { eat: 50, avoid: 50, live: 0 };
  enterStage();
}
function enterStage(): void {
  pick = null; checks = []; last = null; champ = null; marks = 0; stagePowers = []; replay = null;
  if (stage > 0 && !tut()) {
    const r = createRng(run!.seed * 977 + stage * 131 + 7);
    const ids = Object.keys(EVENTS) as EventId[];
    const a = ids[Math.floor(r.next() * ids.length)];
    let b = a; while (b === a) b = ids[Math.floor(r.next() * ids.length)];
    routes = [a, b]; event = a; mode = "route";
  } else { event = "calm"; toDraft(); return; }
  renderAll();
}
function chooseRoute(e: EventId): void {
  event = e; replay = null;
  if (EVENTS[e].hard) { dna += HARD_ROUTE_DNA; toast(`Hard route: +${HARD_ROUTE_DNA} DNA`); }
  toDraft();
}
function toDraft(): void {
  if (tut()) offer = TUTORIAL[stage].offer;
  else {
    const pool = ALL_CARDS.filter((c) => !ownedCards().includes(c));
    const r = createRng(run!.seed * 7919 + stage * 101 + 17);
    const n = EVENTS[event].hard && stage > 0 ? 4 : 3; // a hard route shows one more card
    const deck = pool.slice();
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    offer = deck.slice(0, n);
  }
  mode = "draft"; replay = null;
  renderAll();
}
function startStage(): void {
  if (!run) return;
  checks = []; last = null; champ = null; marks = 0; stagePowers = []; replay = null;
  mode = "running";
  send({ type: "stage", run: run.n, stage, sp: run.sp, seed: run.seed, layers: run.layers, build: buildNow(), weights: { ...weights }, event, body: bodyNow() });
  renderAll();
}
function usePower(p: Power): void {
  if (mode !== "running" || !run || dna < POWERS[p].cost) return;
  dna -= POWERS[p].cost;
  send({ type: "power", run: run.n, stage, power: p });
  renderHud();
}
function nextStage(): void { stage++; enterStage(); }
function endRun(): void { send({ type: "stop" }); if (run) { run.over = true; persist(); } mode = "summary"; renderAll(); }
function home(): void { if (run?.tutorial && run.over) tutorialMode = false; send({ type: "stop" }); run = null; stage = 0; event = "calm"; mode = "home"; replay = null; champ = null; checks = []; renderAll(); }
function buy(it: Item): void { if (owns(it.id) || wallet() < it.price) return; save.spent += it.price; save.owned.push(it.id); persist(); toast(`Unlocked: ${it.label}`); renderAll(); }

// ---------- the reason line ----------
function reason(rec: StageRec, c: Stats, b: Stats): string {
  const s = sp(), lv = stageLevel(stage, rec.event), build = rec.build, sh = shares(rec.weights);
  if (rec.pass) return rec.score >= 1 ? "Better than the hand-written bot." : rec.score < bar() * 1.1 ? "Close call: just over the bar." : "Cleared.";
  if (s.goal !== "alive" && sh.eat < 0.2) return sh.live > sh.avoid ? "Your reward pays for staying alive, not for eating, so they learned to keep away from everything." : "Your reward pays for not eating poison, so they learned not to eat at all.";
  if (s.goal === "eaten" && build.includes("poison") && sh.avoid >= 0.35 && lv.bad > 0) return "For a scavenger poison counts as food and barely hurts, but your reward punishes it, so they skip half of what they could swallow.";
  if (lv.hunters > 0 && c.hunted > b.hunted + 0.1) return build.includes("hunter") ? "They see hunters but didn't learn to flee well enough in time. Shelter can help them learn to eat first." : "Your creatures can't see hunters, so they can't learn to flee them.";
  if (s.goal !== "eaten" && lv.bad > 0 && c.bad > b.bad + 0.5) {
    if (build.includes("poison")) return sh.avoid < 0.35 ? "Your reward barely punishes poison, so they eat it even though they can see it." : "They see poison but didn't learn to avoid it well enough in time.";
    if (build.includes("taste")) return "Taste only tells after the bite, and these brains can't learn during their life, so taste can't help here.";
    return "Your creatures can't tell poison from food, so they eat both.";
  }
  if (c.starved > b.starved + 0.1) return rec.body.includes("legs") && !build.includes("energy") ? "Long legs make them hungry, and they can't feel when they need to eat." : "They starve: they didn't learn to find food well enough.";
  return s.goal === "alive" ? "They die sooner than the bot's creatures." : "They collect less than the bot.";
}

// ---------- the sheet (everything you choose) ----------
function h(tag: string, cls = "", html = ""): HTMLElement { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
function btn(label: string, on: () => void, cls = "plain", disabled = false): HTMLButtonElement { const b = h("button", cls) as HTMLButtonElement; b.textContent = label; b.onclick = on; b.disabled = disabled; return b; }
function cardSlide(c: Card, onPick: (() => void) | null, picked = false, disabled = false): HTMLButtonElement {
  const i = CARD_INFO[c];
  const b = h("button", "slide" + (picked ? " picked" : ""), `<b>${i.name}</b><span class="gain">${i.gain}</span>${i.cost ? `<span class="cost">${i.cost}</span>` : ""}`) as HTMLButtonElement;
  b.style.setProperty("--tag", isBody(c) ? "var(--gold)" : "var(--blue)");
  b.disabled = disabled || !onPick; if (onPick) b.onclick = onPick;
  return b;
}
function rewardSliders(locked: boolean): HTMLElement {
  const box = h("div", "reward"), sh = shares(weights);
  const parts: [keyof Weights, string, string][] = [["eat", "Eating", "food eaten, vs the bot"], ["avoid", "Avoiding poison", "minus poison eaten"], ["live", "Staying alive", "share of the round survived"]];
  for (const [k, name, help] of parts) {
    const l = h("label", "", `${name} <span>${Math.round(sh[k] * 100)}%</span><small>${help}</small>`);
    const r = document.createElement("input"); r.type = "range"; r.min = "0"; r.max = "100"; r.step = "5"; r.value = String(weights[k]); r.disabled = locked;
    r.oninput = () => { weights = { ...weights, [k]: Number(r.value) }; renderSheet(); };
    l.appendChild(r); box.appendChild(l);
  }
  return box;
}

function renderSheet(): void {
  const S = $("sheet"); S.innerHTML = ""; S.classList.remove("hidden");
  const s = sp();
  if (mode === "running") { S.classList.add("hidden"); return; }
  if (mode === "home") {
    S.appendChild(h("h2", "", "Choose a species"));
    S.appendChild(h("p", "", "You never steer the creatures. You choose what they can sense, how their body works, and what evolution rewards; evolution writes the brain."));
    S.appendChild(h("p", "", "On the plate: pale food beads, violet poison, slate hunters. Creatures show what they are doing: green eat, violet avoid, red flee, grey wander."));
    const g = h("div", "slides");
    SPECIES.forEach((x, i) => {
      const open = owns(`species:${x.id}`);
      const b = h("button", "slide" + (i === spIdx ? " picked" : ""), `<b>${x.name}${open ? "" : " 🔒"}</b><span class="note">${x.blurb}</span>`) as HTMLButtonElement;
      b.disabled = !open; b.onclick = () => { spIdx = i; replay = null; renderAll(); };
      g.appendChild(b);
    });
    S.appendChild(g);
    const row = h("div", "row");
    if (spIdx === 0) {
      row.appendChild(btn(tutorialMode ? "Tutorial: on" : "Tutorial: off", () => { tutorialMode = !tutorialMode; renderSheet(); }));
    }
    row.appendChild(btn(spIdx === 0 && tutorialMode ? "Start the tutorial" : `Start a run as ${s.name}`, () => startRun(), "go"));
    if (!(spIdx === 0 && tutorialMode)) {
      const d = new Date(), daily = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      row.appendChild(btn(`Daily seed ${daily}`, () => startRun(daily)));
    }
    row.appendChild(btn("Unlocks", () => { mode = "unlocks"; renderSheet(); }));
    row.appendChild(btn("Past runs", () => { mode = "history"; renderSheet(); }));
    S.appendChild(row);
    return;
  }
  if (mode === "unlocks") {
    S.appendChild(h("h2", "", "Unlocks"));
    S.appendChild(h("p", "", "Each cleared stage pays 1 cred. Unlocks stay for every future run."));
    const g = h("div", "slides");
    for (const it of SHOP) {
      const b = h("button", "slide", `<b>${it.label}${owns(it.id) ? " ✓" : ""}</b><span class="note">${it.note ?? ""}</span>${it.warning ? `<span class="warning">${it.warning}</span>` : ""}<span class="gain">${owns(it.id) ? "owned" : `${it.price} creds`}</span>`) as HTMLButtonElement;
      b.style.setProperty("--tag", "var(--gold)");
      b.disabled = owns(it.id) || wallet() < it.price; b.onclick = () => buy(it);
      g.appendChild(b);
    }
    S.appendChild(g);
    const br = h("div", "row");
    br.appendChild(h("span", "", "Brain:"));
    for (const [lab, ls, need] of [["1 layer of 6", [6], ""], ["2 layers of 6", [6, 6], "layers:2"]] as const)
      br.appendChild(btn(lab + (layers.length === ls.length ? " ✓" : ""), () => { layers = [...ls]; renderSheet(); }, "plain", !!need && !owns(need)));
    S.appendChild(br);
    const row = h("div", "row"); row.appendChild(btn("Back", () => { mode = "home"; renderSheet(); }, "go"));
    row.appendChild(btn("Reset all progress", () => { save = fresh(); persist(); spIdx = 0; layers = [6]; tutorialMode = true; renderAll(); }));
    S.appendChild(row);
    return;
  }
  if (mode === "history") {
    S.appendChild(h("h2", "", "Past runs"));
    const wrap = h("div", "scroll"), t = h("table");
    t.innerHTML = "<thead><tr><th>Run</th><th>Species</th><th>Seed</th><th>Cards</th><th>Stages</th><th>Score</th><th>Creds</th></tr></thead>";
    const tb = h("tbody");
    for (const r of [...save.runs].reverse()) {
      const tr = h("tr");
      const cards = r.stages.map((x) => (x.card ? CARD_INFO[x.card].name : "—")).join(", ") || "—";
      const st = r.stages.map((x) => `${EVENTS[x.event].name} ${x.score.toFixed(2)}${x.pass ? "" : " ✗"}`).join(" · ");
      for (const c of [String(r.n), SPECIES[r.sp].name + (r.tutorial ? " (tutorial)" : ""), String(r.seed), cards, st, r.score.toFixed(2), String(r.creds)]) { const td = h("td"); td.textContent = c; tr.appendChild(td); }
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); S.appendChild(wrap);
    S.appendChild(h("div", "row")).appendChild(btn("Back", () => { mode = "home"; renderSheet(); }, "go"));
    return;
  }
  const lv = lvNow();
  if (mode === "route") {
    S.appendChild(h("h2", "", `Stage ${stage + 1}: choose a route`));
    S.appendChild(h("p", "", `${STAGES[stage].blurb} A hard route pays ${HARD_ROUTE_DNA} DNA now and shows one more card in the draft.`));
    const g = h("div", "slides");
    for (const e of routes) {
      const E = EVENTS[e];
      const b = h("button", "slide", `<b>${STAGES[stage].name}: ${E.name}</b><span class="${E.hard ? "cost" : "gain"}">${E.info}</span><span class="note">${E.hard ? `hard route: +${HARD_ROUTE_DNA} DNA, 4 cards` : "easy route: 3 cards"}</span>`) as HTMLButtonElement;
      b.style.setProperty("--tag", E.hard ? "var(--red)" : "var(--green)");
      b.onclick = () => chooseRoute(e);
      g.appendChild(b);
    }
    S.appendChild(g);
    S.appendChild(h("div", "row")).appendChild(btn("Quit run", endRun));
    return;
  }
  if (mode === "draft") {
    S.appendChild(h("h2", "", `Stage ${stage + 1}: ${STAGES[stage].name}${event !== "calm" ? `, ${EVENTS[event].name.toLowerCase()}` : ""}`));
    S.appendChild(h("p", "", `Goal: ${GOAL_TEXT[s.goal]}. Pass: ${bar()} of the hand-written bot, averaged over the last ${SCORE_CHECKS} checks of ${BUDGET} generations.`));
    if (tut()) S.appendChild(h("p", "hint", TUTORIAL[stage].before));
    if (offer.length) {
      S.appendChild(h("p", "", `Draft one card. You have: food${ownedCards().length ? ", " + ownedCards().map((c) => CARD_INFO[c].name.toLowerCase()).join(", ") : ""}.`));
      const g = h("div", "slides");
      for (const c of offer) {
        const locked = tut() && c !== TUTORIAL[stage].must;
        g.appendChild(cardSlide(c, locked ? null : () => { pick = pick === c ? null : c; renderSheet(); }, pick === c, locked));
      }
      S.appendChild(g);
    }
    S.appendChild(h("p", "", tut() ? "Reward (locked in the tutorial at 50 / 50: exactly the grazer's goal):" : "Reward: what evolution scores. Some mixes are traps, and the best mix changes with the stage."));
    S.appendChild(rewardSliders(tut()));
    const row = h("div", "row");
    row.appendChild(btn(`Evolve ${BUDGET} generations`, startStage, "go", offer.length > 0 && !pick));
    if (!tut()) row.appendChild(btn("Reset reward to 50 / 50 / 0", () => { weights = { eat: 50, avoid: 50, live: 0 }; renderSheet(); }));
    row.appendChild(btn("Quit run", endRun));
    S.appendChild(row);
    return;
  }
  if (mode === "result") {
    const rec = run!.stages[stage];
    S.appendChild(h("div", "verdict " + (rec.pass ? "pass" : "fail"), rec.pass ? `Stage cleared: ${rec.score.toFixed(2)}` : `Stage failed: ${rec.score.toFixed(2)}, bar ${bar()}`));
    if (last) S.appendChild(h("p", "", reason(rec, last.champStats, last.ruleStats)));
    if (tut() && rec.pass) S.appendChild(h("p", "hint", TUTORIAL[stage].after));
    const row = h("div", "row");
    if (rec.pass && stage < STAGES.length - 1) { row.appendChild(btn("Next stage", nextStage, "go")); row.appendChild(btn("Quit run", endRun)); }
    else row.appendChild(btn("See the run", () => { mode = "summary"; renderAll(); }, "go"));
    S.appendChild(row);
    return;
  }
  // summary
  const r = run!, cleared = r.stages.filter((x) => x.pass).length;
  S.appendChild(h("div", "verdict " + (cleared === 3 ? "pass" : "fail"), cleared === 3 ? "Run complete" : `Run over: ${cleared} of 3 stages cleared`));
  const wrap = h("div", "scroll"), t = h("table");
  t.innerHTML = "<thead><tr><th>Stage</th><th>Route</th><th>Card</th><th>Powers</th><th>Score</th></tr></thead>";
  const tb = h("tbody");
  r.stages.forEach((x, i) => {
    const tr = h("tr");
    for (const c of [STAGES[i].name, EVENTS[x.event].name, x.card ? CARD_INFO[x.card].name : "—", x.powers.map((p) => `${POWERS[p.power].name} @${p.gen}`).join(", ") || "—", `${x.score.toFixed(2)} ${x.pass ? "✓" : "✗"}`]) { const td = h("td"); td.textContent = c; tr.appendChild(td); }
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); S.appendChild(wrap);
  S.appendChild(h("p", "", `Run score ${r.score.toFixed(2)} (hard routes count 1.5×). Creds +${r.creds}. Seed ${r.seed}: the same seed and the same choices always give the same run.`));
  const row = h("div", "row");
  if (r.tutorial) row.appendChild(btn("Start a normal run", () => { home(); spIdx = 0; tutorialMode = false; startRun(); }, "go"));
  else { row.appendChild(btn("New run", () => { const k = r.sp; home(); spIdx = k; startRun(); }, "go")); row.appendChild(btn("Same seed again", () => { const k = r.sp, sd = r.seed; home(); spIdx = k; startRun(sd); })); }
  row.appendChild(btn("Back to start", home));
  S.appendChild(row);
}

// ---------- annotations around the plate ----------
function renderHud(): void {
  const s = sp();
  $("label").innerHTML = run
    ? `<div class="species">${s.name}${tut() ? " · tutorial" : ""}</div><div class="where">Stage ${stage + 1} of 3: ${STAGES[stage].name}${event !== "calm" ? `, ${EVENTS[event].name.toLowerCase()}` : ""}</div><div class="goal">Goal: ${GOAL_TEXT[s.goal]}. Senses: food${buildNow().length ? ", " + buildNow().map((c) => CARD_INFO[c].name.toLowerCase().replace("see ", "")).join(", ") : ""}${bodyNow().length ? ". Body: " + bodyNow().map((c) => CARD_INFO[c].name.toLowerCase()).join(", ") : ""}.</div>`
    : `<div class="species">Instinct Lab</div><div class="where">Design the instincts. Evolution writes the brain.</div>`;
  $("purse").innerHTML = `<div class="dna">${run ? `${dna} DNA` : ""}</div><div class="creds">${wallet()} creds</div>`;
  if (run && mode !== "summary") $("purse").appendChild(btn("Quit run", endRun));
  const sc = scoreNow();
  $("readout").innerHTML = run && (mode === "running" || mode === "result")
    ? `Generation <b>${last?.gen ?? 0}</b> of ${BUDGET}<br>Score <b>${sc.toFixed(2)}</b>, bar ${bar()}<br>${stagePowers.filter((p) => (last?.gen ?? 0) <= p.until).map((p) => `${POWERS[p.power].name} on`).join(", ")}`
    : "";
  const P = $("powers"); P.innerHTML = "";
  if (run && mode === "running") for (const p of Object.keys(POWERS) as Power[]) {
    const b = h("button", "power", `<span class="cost">${POWERS[p].cost}</span><b>${POWERS[p].name}</b><small>${POWERS[p].info}</small>`) as HTMLButtonElement;
    b.disabled = mode !== "running" || dna < POWERS[p].cost;
    b.title = `${POWERS[p].info} for ${POWERS[p].gens} generations. Changes only the world evolution trains in; the test maps never change.`;
    b.onclick = () => usePower(p);
    P.appendChild(b);
  }
}

// ---------- the plate ----------
let replay: World | null = null, replayOf = "", lastFrame = performance.now(), owed = 0, pulse = 0;
interface Fx { x: number; y: number; t: number; color: string }
let fx: Fx[] = [], prevGood: number[] = [], prevBad: number[] = [], prevAlive: boolean[] = [];
function css(n: string) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function nextReplay(): World {
  const s = sp(), lv = plateLevel();
  fx = []; prevGood = []; prevBad = []; prevAlive = [];
  if (champ && run) { replayOf = "best"; return new World(lv, false, buildNow(), run.layers, Array.from({ length: POP }, () => champ!), HELD[0], s, makeBody(s, bodyNow())); }
  replayOf = "bot";
  return new World(lv, true, [], [], Array.from({ length: POP }, () => []), HELD[0], s);
}
const plateLevel = (): Level => (!run ? STAGES[0] : mode === "route" ? STAGES[stage] : lvNow()); // no event shown before the route is chosen
// a point at share t (0..1) along a rounded square's edge, clockwise from the top middle
function rimPoint(x: number, y: number, size: number, rad: number, t: number): [number, number] {
  const st = size - 2 * rad, arc = (Math.PI / 2) * rad, total = 4 * st + 4 * arc;
  let d = ((t % 1) + 1) % 1 * total;
  const segs: [number, (u: number) => [number, number]][] = [
    [st / 2, (u) => [x + size / 2 + u, y]],
    [arc, (u) => { const a = -Math.PI / 2 + u / rad; return [x + size - rad + rad * Math.cos(a), y + rad + rad * Math.sin(a)]; }],
    [st, (u) => [x + size, y + rad + u]],
    [arc, (u) => { const a = u / rad; return [x + size - rad + rad * Math.cos(a), y + size - rad + rad * Math.sin(a)]; }],
    [st, (u) => [x + size - rad - u, y + size]],
    [arc, (u) => { const a = Math.PI / 2 + u / rad; return [x + rad + rad * Math.cos(a), y + size - rad + rad * Math.sin(a)]; }],
    [st, (u) => [x, y + size - rad - u]],
    [arc, (u) => { const a = Math.PI + u / rad; return [x + rad + rad * Math.cos(a), y + rad + rad * Math.sin(a)]; }],
    [st / 2, (u) => [x + rad + u, y]],
  ];
  for (const [len, f] of segs) { if (d <= len) return f(d); d -= len; }
  return [x + size / 2, y];
}
function draw(): void {
  const cv = $("scope") as HTMLCanvasElement, dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the microscope: slate surround, the light falls on the plate
  const mobile = W < 640, top = mobile ? 74 : 86, bottom = mobile ? 120 : 92;
  const size = Math.max(160, Math.min(W - 40, H - top - bottom));
  const x0 = (W - size) / 2, y0 = top + (H - top - bottom - size) / 2, rad = size * 0.05;
  const lg = g.createRadialGradient(W / 2, y0 + size / 2, size * 0.2, W / 2, y0 + size / 2, Math.max(W, H) * 0.75);
  lg.addColorStop(0, css("--scope-2")); lg.addColorStop(1, css("--scope"));
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  // the rim: score climbs clockwise from the top; the red notch is the pass bar (60% of the way round)
  const full = bar() / 0.6, sc = run ? scoreNow() : 0, share = Math.max(0, Math.min(1, sc / full));
  const rr = 9, rx = x0 - rr, ry = y0 - rr, rs = size + 2 * rr, rrad = rad + rr;
  g.lineCap = "round";
  g.lineWidth = 6; g.strokeStyle = "#33454f";
  g.beginPath(); g.roundRect(rx, ry, rs, rs, rrad); g.stroke();
  if (share > 0) {
    g.strokeStyle = pulse > 0 ? css("--gold") : css("--blue"); g.lineWidth = 6 + pulse * 6;
    g.beginPath();
    const N = Math.max(2, Math.ceil(share * 240));
    for (let i = 0; i <= N; i++) { const [px, py] = rimPoint(rx, ry, rs, rrad, (share * i) / N); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
  }
  pulse = Math.max(0, pulse - 0.02);
  { const [bx, by] = rimPoint(rx, ry, rs, rrad, 0.6); g.fillStyle = css("--red"); g.beginPath(); g.arc(bx, by, 7, 0, Math.PI * 2); g.fill(); }
  // the plate
  g.save();
  g.beginPath(); g.roundRect(x0, y0, size, size, rad); g.fillStyle = css("--agar"); g.fill();
  g.lineWidth = 2; g.strokeStyle = css("--agar-edge"); g.stroke();
  g.clip();
  if (!replay || replay.done || (replayOf === "bot" && champ && run)) replay = nextReplay();
  const w = replay, k = size / 400;
  const now = performance.now(), dt = Math.min(100, now - lastFrame); lastFrame = now;
  owed += (dt / 1000) * 240;
  for (; owed >= 1 && !w.done; owed--) {
    w.step();
    for (let i = 0; i < w.px.length; i++) {
      if ((prevGood[i] ?? 0) < w.st[i].good) fx.push({ x: w.px[i], y: w.py[i], t: 1, color: css("--green") });
      if ((prevBad[i] ?? 0) < w.st[i].bad) fx.push({ x: w.px[i], y: w.py[i], t: 1, color: css("--violet") });
      if (prevAlive[i] !== false && !w.alive[i] && w.st[i].hunted) fx.push({ x: w.px[i], y: w.py[i], t: 1.6, color: css("--red") });
      prevGood[i] = w.st[i].good; prevBad[i] = w.st[i].bad; prevAlive[i] = w.alive[i];
    }
  }
  const X = (v: number) => x0 + v * k, Y = (v: number) => y0 + v * k;
  for (let f = 0; f < w.fx.length; f++) {
    g.beginPath(); g.arc(X(w.fx[f]), Y(w.fy[f]), Math.max(2.4, 3.2 * k), 0, Math.PI * 2);
    g.fillStyle = w.bad[f] ? css("--violet") : css("--food"); g.fill();
    if (!w.bad[f]) { g.strokeStyle = css("--food-rim"); g.lineWidth = 1; g.stroke(); }
  }
  for (const e of fx) { g.strokeStyle = e.color; g.globalAlpha = Math.min(1, e.t); g.lineWidth = 1.5; g.beginPath(); g.arc(X(e.x), Y(e.y), 4 + (1 - Math.min(1, e.t)) * 6 + (e.t > 1 ? 4 : 0), 0, Math.PI * 2); g.stroke(); e.t -= 0.09; }
  g.globalAlpha = 1; fx = fx.filter((e) => e.t > 0);
  const colors = [css("--green"), css("--violet"), css("--red"), "#7d8a8c"];
  for (let i = 0; i < w.px.length; i++) {
    if (!w.alive[i]) continue;
    const c = colors[w.act[i]];
    g.fillStyle = c; g.beginPath(); g.arc(X(w.px[i]), Y(w.py[i]), Math.max(3.5, 5 * k), 0, Math.PI * 2); g.fill();
    g.strokeStyle = c; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(w.px[i]), Y(w.py[i])); g.lineTo(X(w.px[i] + w.hx[i] * 9), Y(w.py[i] + w.hy[i] * 9)); g.stroke();
  }
  g.fillStyle = css("--hunter");
  for (let hh = 0; hh < w.kx.length; hh++) {
    const x = w.kx[hh], y = w.ky[hh], dx = w.kdx[hh], dy = w.kdy[hh];
    g.beginPath(); g.moveTo(X(x + dx * 10), Y(y + dy * 10)); g.lineTo(X(x - dx * 7 - dy * 7), Y(y - dy * 7 + dx * 7)); g.lineTo(X(x - dx * 7 + dy * 7), Y(y - dy * 7 - dx * 7)); g.closePath(); g.fill();
  }
  if (plateLevel().sight) { g.fillStyle = "rgba(20, 30, 40, .28)"; g.fillRect(x0, y0, size, size); } // night
  g.restore();
  // caption under the plate
  g.fillStyle = css("--dim"); g.font = `13px Recursive, system-ui, sans-serif`; g.textAlign = "center";
  const alive = w.alive.filter(Boolean).length;
  if (!mobile) g.fillText(`${replayOf === "best" ? `Best brain so far, on a map it never trained on` : run ? "Hand-written bot, the score to beat" : "Hand-written bot"} · ${alive} of ${POP} alive`, W / 2, y0 - 22);
  requestAnimationFrame(draw);
}

// ---------- misc ----------
let toastTimer = 0;
function toast(msg: string): void { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("show"), 1600); }
function renderAll(): void { renderHud(); renderSheet(); }
renderAll();
requestAnimationFrame(draw);

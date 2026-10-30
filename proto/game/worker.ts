// Runs a stage of evolution off the page's main thread.
import { Runner, type StageStart, type Stop, type Out } from "./runner.ts";

const runner = new Runner();
let current = 0; // bumps on every message, so an old stage loop notices it should end
const ch = new MessageChannel(); // yields without setTimeout's 4 ms minimum
let wake: () => void = () => {};
ch.port1.onmessage = () => wake();
const tick = () => new Promise<void>((ok) => { wake = ok; ch.port2.postMessage(0); });

self.onmessage = async (e: MessageEvent<StageStart | Stop>) => {
  const m = e.data, me = ++current;
  if (m.type === "stop") return;
  const it = runner.stage(m, (o: Out) => (self as unknown as Worker).postMessage(o));
  let n = 0;
  for (let r = it.next(); !r.done; r = it.next()) if (++n % 40 === 0) { await tick(); if (me !== current) return; }
};

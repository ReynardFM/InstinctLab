// What the queue and its workers are doing right now:  npm run queue-status [-- --url=redis://host:port]
import { connect, indexOf, KEYS, runOf } from "../src/queue/redis-queue.ts";

const url = process.argv.find((a) => a.startsWith("--url="))?.slice(6) ?? "redis://127.0.0.1:6379";
const r = await connect(url);
const pending = await r.lLen(KEYS.pending);
const active = await r.lRange(KEYS.active, 0, -1);
const workerKeys = await r.keys(KEYS.worker("*"));
const workers = await Promise.all(workerKeys.map(async (k) => [k.slice(KEYS.worker("").length), await r.get(k)] as const));
console.log(`queue at ${url}`);
console.log(`  waiting:  ${pending} run(s)`);
console.log(`  running:  ${active.length} run(s)`);
for (const id of active) {
  const [owner, ttl, failures] = await Promise.all([r.get(KEYS.lease(id)), r.pTTL(KEYS.lease(id)), r.hGet(KEYS.job(id), "failures")]);
  const lease = owner ? `${owner}, lease ${(ttl / 1000).toFixed(0)} s left` : "NO LEASE: its worker went quiet; retried after 30 s";
  console.log(`    grid ${runOf(id)} run #${indexOf(id) + 1} (attempt ${Number(failures ?? 0) + 1}): ${lease}`);
}
console.log(`  workers:  ${workers.length} alive`);
const describe = (doing: string | null) => {
  const id = doing?.startsWith("run ") ? doing.slice(4) : null; // "run <grid>:<index>" from worker-main.ts
  return id ? `grid ${runOf(id)} run #${indexOf(id) + 1}` : (doing ?? "?");
};
for (const [name, doing] of workers.sort()) console.log(`    ${name}: ${describe(doing)}`);
await r.quit();

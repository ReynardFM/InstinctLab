// Overnight queue (Rey 2026-11-02): waits for night-batch.ts to finish (batch-summary.txt), then runs tests that
// Claude appends to proto/out/life-genes/queue.txt while Rey sleeps. One test per line:
//   name | what it tests | --arg=value --arg=value
// Lines starting with # are ignored; a line "end" stops the queue. Re-reads the file after every test; with nothing
// pending it checks every 5 minutes and gives up after 4 hours idle. Summaries: proto/out/life-genes/<name>.txt,
// all joined in queue-summary.txt. Finished tests are skipped (safe to restart).
//   node src/cli/night-queue.ts
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const DIR = "proto/out/life-genes";
const QUEUE = `${DIR}/queue.txt`;
const IDLE_MAX = 4 * 60 * 60 * 1000, POLL = 5 * 60 * 1000;
if (!existsSync(QUEUE)) writeFileSync(QUEUE, "# name | what | --args (Claude appends tests here; a line 'end' stops the queue)\n");

const now = () => new Date().toLocaleTimeString();
while (!existsSync(`${DIR}/batch-summary.txt`)) { console.log(`${now()} waiting for night-batch to finish`); await sleep(POLL); }

let idle = 0;
for (;;) {
  const lines = readFileSync(QUEUE, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines[0] === "end" && lines.length === 1) break;
  const todo = lines.filter((l) => l !== "end").map((l) => l.split("|").map((x) => x.trim())).find(([n]) => !existsSync(`${DIR}/${n}.txt`) && !existsSync(`${DIR}/${n}.failed.txt`));
  if (!todo) {
    if (lines.includes("end")) break;
    if (idle >= IDLE_MAX) { console.log(`${now()} idle 4 h, stopping`); break; }
    await sleep(POLL); idle += POLL; continue;
  }
  idle = 0;
  const [name, what, args = ""] = todo;
  console.log(`${now()} run ${name}: ${what}`);
  const r = spawnSync(process.execPath, ["src/cli/life-genes.ts", `--workers=${Math.max(1, Math.floor(availableParallelism() / 2))}`, `--out=${name}`, ...args.split(/\s+/).filter(Boolean)], { encoding: "utf8", maxBuffer: 1 << 24 });
  const out = `== ${name}: ${what}\n${r.stdout}${r.status ? `\nFAILED (exit ${r.status}):\n${r.stderr.slice(-2000)}` : ""}\n`;
  writeFileSync(`${DIR}/${name}${r.status ? ".failed" : ""}.txt`, out);
  appendFileSync(`${DIR}/queue-summary.txt`, out);
  if (r.status) console.log("  FAILED");
}
console.log(`${now()} queue done -> ${DIR}/queue-summary.txt`);

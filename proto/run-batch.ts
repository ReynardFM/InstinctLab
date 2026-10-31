// All of Rey's pending balance tests in one go (2026-10-30), one after another, at half the threads and low
// priority. A step whose output already exists is skipped, so after a stop just run it again to continue.
// Progress and times go to proto/out/batch.log.   node proto/run-batch.ts [--only=threats,terrain]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, openSync, closeSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
// [group, output that marks the step done, arguments for node, file to save the printed output in (optional)]
const STEPS: [string, string, string[], string?][] = [
  ["threats", "proto/out/threats/tune-v2-A-sp12.json", ["proto/tune-v2.ts", "--phase=A", "--threats=1", "--sp=1,2", "--out=proto/out/threats"]],
  ["threats", "proto/out/threats/report.txt", ["proto/tune-v2-report.ts", "--dir=proto/out/threats", "--base=proto/out/round2"], "proto/out/threats/report.txt"],
  ["threats", "proto/out/threats/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/threats"], "proto/out/threats/paired.txt"],
  ["neighbour", "proto/out/nA/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--nbinfo=1", "--only=neighbour", "--out=proto/out/nA"]],
  ["neighbour", "proto/out/nB/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--confuse=1", "--follow=1", "--out=proto/out/nB"]],
  ["neighbour", "proto/out/nAB/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--nbinfo=1", "--confuse=1", "--follow=1", "--only=neighbour", "--out=proto/out/nAB"]],
  ["neighbour", "proto/out/nA/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/nA"], "proto/out/nA/paired.txt"],
  ["neighbour", "proto/out/nB/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/nB"], "proto/out/nB/paired.txt"],
  ["neighbour", "proto/out/nAB/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/nAB", "--base=proto/out/nB"], "proto/out/nAB/paired.txt"],
  ["neighbour", "proto/out/nB/report.txt", ["proto/tune-v2-report.ts", "--dir=proto/out/nB"], "proto/out/nB/report.txt"],
  ["terrain", "proto/out/terrain/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--terrain=river,farm,zone", "--out=proto/out/terrain"]],
  ["terrain", "proto/out/terrain/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/terrain"], "proto/out/terrain/paired.txt"],
  ["terrain", "proto/out/terrain/report.txt", ["proto/tune-v2-report.ts", "--dir=proto/out/terrain"], "proto/out/terrain/report.txt"],
  ["terrain", "proto/out/terrainRaid/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--terrain=river,farm,zone", "--raid=20", "--out=proto/out/terrainRaid"]],
  ["terrain", "proto/out/terrainRaid/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/terrainRaid", "--base=proto/out/terrain"], "proto/out/terrainRaid/paired.txt"],
  ["tmoves", "proto/out/tmoves/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--terrain=river,farm,zone", "--tmoves=1", "--follow=1", "--only=terrain,neighbour", "--out=proto/out/tmoves"]],
  ["tmoves", "proto/out/tmoves/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/tmoves", "--base=proto/out/terrain"], "proto/out/tmoves/paired.txt"],
  ["tmoves", "proto/out/tmoves/report.txt", ["proto/tune-v2-report.ts", "--dir=proto/out/tmoves", "--base=proto/out/terrain"], "proto/out/tmoves/report.txt"],
  ["thirst", "proto/out/thirst/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--terrain=river,farm,zone", "--tmoves=1", "--thirst=1", "--out=proto/out/thirst"]],
  ["thirst", "proto/out/thirst/report.txt", ["proto/tune-v2-report.ts", "--dir=proto/out/thirst"], "proto/out/thirst/report.txt"],
  ["thirst", "proto/out/thirst/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/thirst", "--base=proto/out/terrain"], "proto/out/thirst/paired.txt"],
  ["legs", "proto/out/legsgrow/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--legsgrow=120", "--only=legs", "--out=proto/out/legsgrow"]],
  ["legs", "proto/out/legsgrow/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/legsgrow"], "proto/out/legsgrow/paired.txt"],
  ["legs", "proto/out/timing/report.txt", ["proto/tune-run-v2.ts", "--timing=1", "--legsgrow=120", "--events=all", "--out=proto/out/timing"], "proto/out/timing/report.txt"],
  ["moves", "proto/out/moves1/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--energy=rest", "--taste=spit", "--only=energy,taste", "--out=proto/out/moves1"]],
  ["moves", "proto/out/moves2/tune-v2-A.json", ["proto/tune-v2.ts", "--phase=A", "--energy=slow", "--taste=avoid", "--only=energy,taste", "--out=proto/out/moves2"]],
  ["moves", "proto/out/moves1/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/moves1"], "proto/out/moves1/paired.txt"],
  ["moves", "proto/out/moves2/paired.txt", ["proto/tune-v2-paired.ts", "--dir=proto/out/moves2"], "proto/out/moves2/paired.txt"],
  ["run", "proto/out/run/report.txt", ["proto/tune-run-v2.ts", "--events=all", "--out=proto/out/run"], "proto/out/run/report.txt"],
];
mkdirSync("proto/out", { recursive: true });
const log = (m: string) => { const line = `${new Date().toISOString().slice(0, 19)} ${m}`; console.log(line); appendFileSync("proto/out/batch.log", line + "\n"); };
const t0 = Date.now();
for (const [group, done, args, save] of STEPS) {
  if (only && !only.includes(group)) continue;
  if (existsSync(done)) { log(`skip (done): ${args.join(" ")}`); continue; }
  log(`start: node ${args.join(" ")}${save ? `  (report saved to ${save}; progress shows below)` : ""}`);
  const t = Date.now();
  let fd: number | undefined;
  if (save) { mkdirSync(dirname(save), { recursive: true }); fd = openSync(save + ".part", "w"); } // renamed only on success
  const r = spawnSync(process.execPath, args, { stdio: ["ignore", fd ?? "inherit", "inherit"] });
  if (fd !== undefined) closeSync(fd);
  if (r.status !== 0) { log(`FAILED (exit ${r.status}): node ${args.join(" ")}`); process.exit(1); }
  if (save) renameSync(save + ".part", save);
  log(`done in ${((Date.now() - t) / 60000).toFixed(1)} min`);
}
log(`all done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

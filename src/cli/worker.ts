// A worker thread: receives jobs one at a time, runs them, sends the result back.
import { parentPort } from "node:worker_threads";
import { runJob, type Job } from "./job.ts";

parentPort!.on("message", (m: { index: number; job: Job }) => {
  parentPort!.postMessage({ index: m.index, result: runJob(m.job) });
});

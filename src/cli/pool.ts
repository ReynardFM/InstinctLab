// Spreads jobs over worker threads (one per CPU core by default). Each worker takes the next waiting
// job as soon as it finishes one, so a slow job doesn't hold the others up. Results come back in
// job order, so the output is identical whatever the number of workers.
import { Worker } from "node:worker_threads";
import type { Job, JobResult } from "./job.ts";

export function runJobs(jobs: Job[], workers: number, onProgress?: (done: number) => void): Promise<JobResult[]> {
  const results: JobResult[] = new Array(jobs.length);
  if (jobs.length === 0) return Promise.resolve(results);
  const count = Math.max(1, Math.min(Math.floor(workers), jobs.length)); // no point in idle workers
  return new Promise((resolve, reject) => {
    const pool: Worker[] = [];
    let next = 0;
    let done = 0;
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      for (const w of pool) void w.terminate();
      if (err) reject(err);
      else resolve(results);
    };
    const giveWork = (w: Worker) => {
      if (next < jobs.length) {
        w.postMessage({ index: next, job: jobs[next] });
        next++;
      }
    };
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url));
      pool.push(w);
      w.on("message", (m: { index: number; result: JobResult }) => {
        results[m.index] = m.result;
        done++;
        onProgress?.(done);
        if (done === jobs.length) finish();
        else giveWork(w);
      });
      w.on("error", (e: Error) => finish(e));
      w.on("exit", (code) => {
        if (code !== 0) finish(new Error(`A worker stopped unexpectedly (exit code ${code})`));
      });
      giveWork(w);
    }
  });
}

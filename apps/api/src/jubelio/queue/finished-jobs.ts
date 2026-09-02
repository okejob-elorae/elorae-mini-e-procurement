import type { Queue } from "bullmq";

/**
 * BullMQ job states that mean the job is done and its deterministic jobId is
 * still occupying the queue. Both Jubelio queues retain finished jobs
 * (`removeOnComplete`/`removeOnFail` keep thousands), so a retained job silently
 * swallows every later `add()` for the same row unless it is removed first.
 * "unknown" is Redis reporting no such job, which is equally safe to drop.
 */
export const FINISHED_JOB_STATES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "unknown",
]);

/**
 * True when `jobId` is free to reuse — either nothing held it, or a finished job
 * held it and has now been removed. False means a live job owns it, and adding
 * again would be a silent no-op rather than a second run.
 *
 * Both queues key their jobId on the database row id so a row can never be
 * queued twice concurrently. The cost of that dedup is this: without clearing
 * the settled job, a failed row sits non-terminal forever, re-swept on every
 * pass, retried zero times, and never alerted on — measured on prod for 47 days.
 */
export async function clearFinishedJob(queue: Queue, jobId: string): Promise<boolean> {
  const existing = await queue.getJob(jobId);
  if (!existing) return true;
  const state = await existing.getState();
  if (!FINISHED_JOB_STATES.has(state)) return false;
  await existing.remove();
  return true;
}

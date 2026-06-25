// One-off recovery script. Run AFTER PR #63 lands and api is rebuilt.
//
// Resets all JubelioWebhookEvent rows in RECEIVED status to enqueue-eligible
// and re-adds them to the BullMQ webhook queue immediately, instead of waiting
// for the 10-min sweeper to drain them at 100/tick (~15h backlog otherwise).
//
// Usage on VPS:
//   docker compose -f docker-compose.prod.yml cp scripts/replay-stuck-webhooks.mjs api:/tmp/replay.mjs
//   docker compose -f docker-compose.prod.yml exec api node /tmp/replay.mjs
//
// Safe to run multiple times — BullMQ jobId = rowId, so duplicates are
// deduped at the queue layer. Idempotent.
//
// Tunables:
//   DRY_RUN=1       — count + log what would change, write nothing
//   BATCH=500       — page size for DB scan + Redis pipeline (default 500)
//   ONLY_STATUS=RECEIVED  — set to PROCESSING to recover crashed-mid-job rows too
//   QUEUE_NAME      — override default queue name if it differs

import { prisma } from "@elorae/db";
import IORedis from "ioredis";
import { Queue } from "bullmq";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH = Number(process.env.BATCH ?? "500");
const ONLY_STATUS = process.env.ONLY_STATUS ?? "RECEIVED";
const QUEUE_NAME = process.env.QUEUE_NAME ?? "jubelio-webhook";
const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection });

async function main() {
  const totalStuck = await prisma.jubelioWebhookEvent.count({ where: { status: ONLY_STATUS } });
  console.log(`Stuck rows (status=${ONLY_STATUS}): ${totalStuck}`);
  console.log(`DRY_RUN=${DRY_RUN ? "yes" : "no"}  BATCH=${BATCH}  QUEUE=${QUEUE_NAME}`);

  if (totalStuck === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    const sample = await prisma.jubelioWebhookEvent.findMany({
      where: { status: ONLY_STATUS },
      orderBy: { receivedAt: "asc" },
      take: 5,
      select: { id: true, event: true, receivedAt: true, attempts: true, lastEnqueuedAt: true },
    });
    console.log("Sample:");
    for (const r of sample) console.log(`  ${r.receivedAt.toISOString()}  ${r.event}  attempts=${r.attempts}  lastEnqueuedAt=${r.lastEnqueuedAt?.toISOString() ?? "null"}  id=${r.id}`);
    console.log("Dry run — no writes performed.");
    return;
  }

  let processed = 0;
  let cursor = undefined;
  while (true) {
    const rows = await prisma.jubelioWebhookEvent.findMany({
      where: { status: ONLY_STATUS, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    });
    if (rows.length === 0) break;

    if (ONLY_STATUS === "PROCESSING") {
      await prisma.jubelioWebhookEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: "RECEIVED" },
      });
    }

    // Pipeline the BullMQ adds. jobId=rowId dedupes if the row already has a job.
    await Promise.all(
      rows.map((r) =>
        queue.add(
          "process",
          { rowId: r.id },
          {
            jobId: r.id,
            attempts: 5,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 1000 },
          },
        ),
      ),
    );

    // Stamp lastEnqueuedAt so sweeper doesn't double-enqueue these soon.
    await prisma.jubelioWebhookEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { lastEnqueuedAt: new Date() },
    });

    processed += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`  enqueued ${processed} / ${totalStuck} (cursor=${cursor})`);
  }

  console.log(`Done. Enqueued ${processed} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  });

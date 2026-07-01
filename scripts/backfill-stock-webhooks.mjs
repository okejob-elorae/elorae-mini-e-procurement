// One-off recovery script. Run AFTER PR #78 lands and api is rebuilt.
//
// Resets JubelioWebhookEvent rows that were SKIPPED with the pre-fix
// "orphan_sku:*" reason (stock webhook handler expected the old {item_code, end_qty}
// payload). The new handler consumes the notification shape ({item_group_id,
// item_ids[]}) and refetches actual quantities. Replaying these lets the new
// code path run against the historical payloads.
//
// Usage on VPS:
//   docker compose -f docker-compose.prod.yml cp scripts/backfill-stock-webhooks.mjs api:/tmp/backfill.mjs
//   docker compose -f docker-compose.prod.yml exec api node /tmp/backfill.mjs
//
// Safe to run multiple times. The handler is idempotent per (event.id + item_id).
//
// Tunables:
//   DRY_RUN=1       count + log what would change, write nothing
//   BATCH=200       page size for DB scan + Redis pipeline (default 200)
//   QUEUE_NAME      override default queue name if it differs
//   REDIS_URL       override default redis://redis:6379

import { prisma } from "@elorae/db";
import IORedis from "ioredis";
import { Queue } from "bullmq";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH = Number(process.env.BATCH ?? "200");
const QUEUE_NAME = process.env.QUEUE_NAME ?? "jubelio-webhook";
const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection });

// Rows to replay: stock event, SKIPPED, reason starts with "orphan_sku:".
const WHERE = {
  event: "stock",
  status: "SKIPPED",
  skipReason: { startsWith: "orphan_sku:" },
};

async function main() {
  const total = await prisma.jubelioWebhookEvent.count({ where: WHERE });
  console.log(`Skipped stock webhooks to replay: ${total}`);
  console.log(`DRY_RUN=${DRY_RUN ? "yes" : "no"}  BATCH=${BATCH}  QUEUE=${QUEUE_NAME}`);

  if (total === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    const sample = await prisma.jubelioWebhookEvent.findMany({
      where: WHERE,
      orderBy: { receivedAt: "asc" },
      take: 5,
      select: { id: true, event: true, receivedAt: true, skipReason: true },
    });
    console.log("Sample:");
    for (const r of sample) {
      console.log(`  ${r.receivedAt.toISOString()}  ${r.event}  skipReason=${r.skipReason}  id=${r.id}`);
    }
    console.log("Dry run — no writes performed.");
    return;
  }

  let processed = 0;
  let cursor = undefined;
  while (true) {
    const rows = await prisma.jubelioWebhookEvent.findMany({
      where: { ...WHERE, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    });
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);

    // Reset DB — status back to RECEIVED, clear skipReason + processedAt so the
    // handler runs fresh.
    await prisma.jubelioWebhookEvent.updateMany({
      where: { id: { in: ids } },
      data: { status: "RECEIVED", skipReason: null, processedAt: null },
    });

    // Clear BullMQ completed entries — the previous SKIPPED runs marked the
    // jobIds as completed, and .add() with the same jobId is a no-op otherwise.
    await Promise.all(
      ids.flatMap((id) => [
        connection.zrem(`bull:${QUEUE_NAME}:completed`, id),
        connection.del(`bull:${QUEUE_NAME}:${id}`),
      ]),
    );

    // Re-add to queue. jobId=rowId; still idempotent if a fresh job also exists.
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

    // Stamp lastEnqueuedAt so the sweeper doesn't double-enqueue.
    await prisma.jubelioWebhookEvent.updateMany({
      where: { id: { in: ids } },
      data: { lastEnqueuedAt: new Date() },
    });

    processed += rows.length;
    cursor = ids[ids.length - 1];
    console.log(`  enqueued ${processed} / ${total} (cursor=${cursor})`);
  }

  console.log(`Done. Enqueued ${processed} rows. Monitor /jubelio/webhooks or the DB for PROCESSED/SKIPPED counts.`);
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

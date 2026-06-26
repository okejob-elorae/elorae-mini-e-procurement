const fs = require("fs");
for (const line of fs.readFileSync("./apps/web/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { prisma } = require("./packages/db/dist/src/index.js");
(async () => {
  // Currently PROCESSING — are these old replays or fresh arrivals?
  const processingNow = await prisma.jubelioWebhookEvent.findMany({
    where: { status: "PROCESSING" },
    orderBy: { receivedAt: "asc" },
    take: 10,
    select: { id: true, event: true, receivedAt: true, lastEnqueuedAt: true, attempts: true },
  });
  // Recently PROCESSED (last 5 min)
  const recentProcessed = await prisma.jubelioWebhookEvent.findMany({
    where: { status: "PROCESSED", processedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    orderBy: { processedAt: "desc" },
    take: 10,
    select: { event: true, receivedAt: true, processedAt: true },
  });
  // Age histogram of RECEIVED stuck
  const ageBuckets = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN receivedAt > NOW() - INTERVAL 1 HOUR THEN 'last_1h'
        WHEN receivedAt > NOW() - INTERVAL 1 DAY THEN '1h_to_24h'
        WHEN receivedAt > NOW() - INTERVAL 3 DAY THEN '1d_to_3d'
        WHEN receivedAt > NOW() - INTERVAL 7 DAY THEN '3d_to_7d'
        ELSE 'older_7d'
      END AS bucket,
      COUNT(*) AS n
    FROM JubelioWebhookEvent
    WHERE status = 'RECEIVED'
    GROUP BY bucket ORDER BY MIN(receivedAt)
  `);
  console.log("PROCESSING_NOW:");
  for (const r of processingNow) console.log(`  rx=${r.receivedAt.toISOString()}  enq=${r.lastEnqueuedAt?.toISOString() ?? "null"}  attempts=${r.attempts}  ${r.event}`);
  console.log("---");
  console.log("RECENT_PROCESSED (last 5 min):");
  for (const r of recentProcessed) console.log(`  rx=${r.receivedAt.toISOString()}  done=${r.processedAt?.toISOString()}  ${r.event}`);
  console.log("---");
  console.log("RECEIVED_AGE_BUCKETS:", JSON.stringify(ageBuckets, (k, v) => typeof v === "bigint" ? Number(v) : v, 2));
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });

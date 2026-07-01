// Reclaim R2 blobs no longer referenced by ItemImage.url.
//
// Two orphan classes swept:
//   1. `items/_pending/*` — abandoned uploads during item-create flow
//   2. `items/<itemId>/*` — blobs whose ItemImage row was deleted but the
//       best-effort R2 delete in replaceItemImagesAction failed
//
// Safety guards:
//   - DRY_RUN=1 (default) — reports only, no deletes
//   - Grace period (default 24h) — never sweeps recent blobs; in-flight
//     uploads may not yet have an ItemImage row
//   - Scope limited to `items/` prefix — other buckets/prefixes untouched
//   - Aborts on DB or R2 List errors — partial data would over-delete
//
// Self-contained — instantiates its own S3Client. Runs from the api container
// (has @aws-sdk/client-s3 + @elorae/db resolvable):
//
//   docker compose -f docker-compose.prod.yml cp scripts/sweep-r2-orphans.mjs api:/app/apps/api/sweep.mjs
//   docker compose -f docker-compose.prod.yml exec -e DRY_RUN=1 api node /app/apps/api/sweep.mjs
//   docker compose -f docker-compose.prod.yml exec -e DRY_RUN=0 api node /app/apps/api/sweep.mjs
//
// The api container inherits env from .env.production — set R2_* in there OR pass -e for the exec.
//
// Env:
//   DRY_RUN=1         default. 0 to actually delete.
//   GRACE_HOURS=24    default. Skip blobs newer than this.
//   PREFIX=items/     default. Override for other prefixes.
//   SAMPLE=20         default. Sample size printed to stdout.
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

import { prisma } from "@elorae/db";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const DRY_RUN = process.env.DRY_RUN !== "0";
const GRACE_HOURS = Number(process.env.GRACE_HOURS ?? "24");
const PREFIX = process.env.PREFIX ?? "items/";
const SAMPLE = Number(process.env.SAMPLE ?? "20");

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET_NAME ?? "elorae-erp";
const PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "";

function keyFromUrl(url) {
  if (!PUBLIC_URL || !url.startsWith(PUBLIC_URL)) return null;
  return url.slice(PUBLIC_URL.length + 1);
}

async function main() {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    throw new Error("R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.");
  }
  if (!PUBLIC_URL) {
    throw new Error("R2_PUBLIC_URL not set. Cannot derive keys from ItemImage.url.");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  });

  const graceCutoff = new Date(Date.now() - GRACE_HOURS * 3600 * 1000);
  console.log("R2 orphan sweep");
  console.log(`  DRY_RUN=${DRY_RUN ? "yes (no deletes)" : "NO — WILL DELETE"}`);
  console.log(`  PREFIX=${PREFIX}`);
  console.log(`  GRACE_HOURS=${GRACE_HOURS} (cutoff=${graceCutoff.toISOString()})`);
  console.log(`  BUCKET=${BUCKET}`);

  // 1. Read referenced keys from DB.
  console.log("Reading ItemImage URLs from DB...");
  const rows = await prisma.itemImage.findMany({ select: { url: true } });
  const referenced = new Set();
  for (const r of rows) {
    const k = keyFromUrl(r.url);
    if (k !== null) referenced.add(k);
  }
  console.log(`  ${rows.length} rows, ${referenced.size} distinct R2 keys referenced`);

  // 2. List all R2 objects under the prefix.
  console.log(`Listing R2 objects under ${PREFIX}...`);
  const objects = [];
  let continuationToken;
  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const c of resp.Contents ?? []) {
      if (c.Key && c.LastModified) {
        objects.push({ key: c.Key, size: c.Size ?? 0, lastModified: c.LastModified });
      }
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  console.log(`  ${objects.length} objects found`);

  // 3. Classify.
  const orphans = [];
  let recentSkipped = 0;
  let referencedSkipped = 0;
  for (const o of objects) {
    if (referenced.has(o.key)) {
      referencedSkipped++;
      continue;
    }
    if (o.lastModified >= graceCutoff) {
      recentSkipped++;
      continue;
    }
    orphans.push(o);
  }

  const totalBytes = orphans.reduce((s, o) => s + o.size, 0);
  console.log(`Referenced (kept): ${referencedSkipped}`);
  console.log(`Recent (< grace, kept): ${recentSkipped}`);
  console.log(`Orphans: ${orphans.length} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);

  if (orphans.length === 0) {
    console.log("Nothing to sweep.");
    return;
  }

  console.log(`Sample (first ${Math.min(SAMPLE, orphans.length)}):`);
  for (const o of orphans.slice(0, SAMPLE)) {
    console.log(`  ${o.lastModified.toISOString()}  ${(o.size / 1024).toFixed(1)}KB  ${o.key}`);
  }

  if (DRY_RUN) {
    console.log("Dry run — no deletes performed. Set DRY_RUN=0 to sweep.");
    return;
  }

  // 4. Delete in batches of 1000.
  console.log("Deleting...");
  let totalDeleted = 0;
  const allErrors = [];
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000);
    const resp = await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch.map((o) => ({ Key: o.key })), Quiet: false },
    }));
    const deleted = (resp.Deleted ?? []).length;
    const errors = (resp.Errors ?? []).map((e) => ({
      key: e.Key ?? "<unknown>",
      message: e.Message ?? e.Code ?? "unknown",
    }));
    totalDeleted += deleted;
    allErrors.push(...errors);
    console.log(`  batch ${Math.floor(i / 1000) + 1}: deleted ${deleted}/${batch.length}${errors.length ? `, errors: ${errors.length}` : ""}`);
  }
  console.log(`Done. Deleted ${totalDeleted}/${orphans.length}. Errors: ${allErrors.length}.`);
  if (allErrors.length > 0) {
    console.log("First 10 errors:");
    for (const e of allErrors.slice(0, 10)) {
      console.log(`  ${e.key}: ${e.message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("SWEEP FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

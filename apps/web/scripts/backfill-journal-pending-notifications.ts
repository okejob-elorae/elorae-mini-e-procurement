/**
 * One-shot: give the existing unread JOURNAL_PENDING backlog a bell entry.
 *
 * Those alerts stay actionable indefinitely — the document genuinely still has no journal and
 * someone must press the retry button — unlike the approval and store-change categories, whose
 * underlying request may long since have been resolved.
 *
 * Two deliberate differences from the live fan-out. It writes NotificationQueue rows directly
 * rather than calling `sendNotificationToUsers`, because replaying week-old alerts as phone
 * pushes is obnoxious: rows land `sent: false`, so they appear in the bell and nowhere else.
 * And it dedups on the AdminNotification row id rather than anything in its metadata, because
 * the JOURNAL_PENDING writers do not agree on a metadata shape — some write `docId`, the sales
 * sweep writes `orderId`.
 *
 * Dry-run by default:
 *   pnpm exec tsx scripts/backfill-journal-pending-notifications.ts
 * Apply:
 *   pnpm exec tsx scripts/backfill-journal-pending-notifications.ts --apply --confirm-prod-writes
 */
import "dotenv/config";

const apply = process.argv.includes("--apply");
const confirm = process.argv.includes("--confirm-prod-writes");

const CATEGORY = "JOURNAL_PENDING";
const PERMISSION = "journals:manage";

function assertApplyAllowed(url: string): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (/:(3306|3307)(\/|$)/.test(url)) {
    if (!confirm) {
      throw new Error("Refusing write: prod-tunnel URL. Pass --confirm-prod-writes (and --apply).");
    }
    console.warn("WARNING: writing against prod-tunnel DATABASE_URL.");
    return;
  }
  if (!confirm) {
    throw new Error("Refusing write: not local testbed. Pass --confirm-prod-writes.");
  }
}

async function main() {
  /* Imported before the try/finally so the disconnect in `finally` closes the same client. */
  const { prisma } = await import("@elorae/db");
  const url = process.env.DATABASE_URL ?? "";
  console.log(`DATABASE_URL host peek: ${url.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`);
  console.log(`mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  try {
    const pending = await prisma.adminNotification.findMany({
      where: { category: CATEGORY, readAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, message: true, metadata: true, createdAt: true },
    });
    console.log(`\nUnread ${CATEGORY}: ${pending.length}`);
    if (pending.length === 0) return;

    const permission = await prisma.permission.findUnique({ where: { code: PERMISSION } });
    if (!permission) {
      console.error(`Permission ${PERMISSION} does not exist — nobody would receive these. Seed it first.`);
      return;
    }
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { roleDefinition: { isSystem: true } },
          { roleDefinition: { permissions: { some: { permissionId: permission.id } } } },
        ],
      },
      select: { id: true },
    });
    console.log(`Recipients holding ${PERMISSION}: ${users.length}`);
    if (users.length === 0) return;

    /**
     * JSON-path filtering is unreliable on this Prisma adapter (the same constraint documented
     * in `lib/canvassing/journal-pending.ts` and `lib/finance/sales/sweep.ts`), so the existing
     * rows are fetched and matched in JS.
     */
    const existing = await prisma.notificationQueue.findMany({
      where: { type: CATEGORY },
      select: { userId: true, data: true },
    });
    const seen = new Set<string>();
    for (const row of existing) {
      const d = row.data as { adminNotificationId?: string } | null;
      if (d?.adminNotificationId) seen.add(`${row.userId}:${d.adminNotificationId}`);
    }
    console.log(`Already-delivered pairs: ${seen.size}`);

    const toCreate: Array<{ userId: string; notificationId: string; title: string; message: string }> = [];
    for (const n of pending) {
      for (const u of users) {
        if (seen.has(`${u.id}:${n.id}`)) continue;
        toCreate.push({ userId: u.id, notificationId: n.id, title: n.title, message: n.message });
      }
    }
    console.log(`Rows to create: ${toCreate.length}`);

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply --confirm-prod-writes to write.");
      return;
    }

    assertApplyAllowed(url);

    let created = 0;
    for (const row of toCreate) {
      await prisma.notificationQueue.create({
        data: {
          userId: row.userId,
          type: CATEGORY,
          title: row.title,
          body: row.message,
          data: { adminNotificationId: row.notificationId } as object,
          sent: false,
        },
      });
      created += 1;
    }
    console.log(`\nCreated ${created} NotificationQueue rows (sent: false — bell only, no push).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

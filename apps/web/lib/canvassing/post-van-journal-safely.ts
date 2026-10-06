import { prisma, type AdminNotification } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

/**
 * Where a `journals:manage` operator retries each van document kind once the
 * missing posting role is mapped in Account Mapping.
 */
const RETRY_HINT: Record<"load" | "sale" | "reconcile", string> = {
  load: "retry from the canvasser's van detail page (Load History)",
  sale: "retry from the van sale's detail page",
  reconcile: "retry from the van reconcile's detail page",
};

export type VanJournalFailure = { reason: "UNMAPPED_ROLE" | "UNBALANCED" | "ERROR"; role: string | null };

/**
 * Posts a van journal without ever failing the caller. A canvassing sale is a
 * terminal point-of-sale transaction: a finance misconfiguration must not fail
 * it in front of a customer, so a problem becomes a JOURNAL_PENDING notification
 * instead of an error.
 *
 * Returns the failure it classified (`null` when the journal posted or there
 * was nothing to post), so a caller can warn at the moment of action. The
 * failure is returned even when the notification dedup skipped the write or the
 * write itself failed; the `JOURNAL_PENDING` row stays the durable record.
 */
export async function postVanJournalSafely(
  kind: "load" | "sale" | "reconcile",
  docId: string,
  post: () => Promise<GenerateAutoJournalResult>,
): Promise<VanJournalFailure | null> {
  try {
    const res = await post();
    if (res.ok || res.code === "NOTHING_TO_POST") return null;
    const failure: VanJournalFailure = { reason: res.code, role: "role" in res ? (res.role ?? null) : null };
    await notify(kind, docId, failure.reason, failure.role);
    return failure;
  } catch (e) {
    await notify(kind, docId, "ERROR", null, e instanceof Error ? e.message : "unknown");
    return { reason: "ERROR", role: null };
  }
}

/**
 * Skips the write when an unread `JOURNAL_PENDING` already exists for the same
 * document and kind. Mirrors `lib/finance/sales/sweep.ts`'s dedup: this MariaDB
 * adapter's JSON-path filtering is unreliable, so recent unread rows are
 * fetched and deduped in JS rather than filtered in the query.
 */
async function alreadyFlagged(kind: string, docId: string): Promise<boolean> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { metadata: true },
  });
  return recent.some((n) => {
    const m = n.metadata as { docId?: string; kind?: string } | null;
    return m?.docId === docId && m?.kind === `van_${kind}`;
  });
}

/**
 * Lets the bell item open the canvasser a load journal failure belongs to. Its own try/catch
 * because the `JOURNAL_PENDING` row gates the retry button: a failed lookup must cost the link,
 * never the row.
 */
async function lookupCanvasserId(kind: "load" | "sale" | "reconcile", docId: string): Promise<string | undefined> {
  if (kind !== "load") return undefined;
  try {
    const load = await prisma.vanLoad.findUnique({ where: { id: docId }, select: { canvasserId: true } });
    return load?.canvasserId;
  } catch {
    return undefined;
  }
}

async function notify(
  kind: "load" | "sale" | "reconcile",
  docId: string,
  reason: string,
  role: string | null,
  detail?: string,
): Promise<void> {
  let vanJournalNotification: AdminNotification | null = null;
  try {
    if (await alreadyFlagged(kind, docId)) return;
    const canvasserId = await lookupCanvasserId(kind, docId);
    vanJournalNotification = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Van ${kind} journal not posted`,
        message: `Van ${kind} journal could not be posted (${reason}${role ? `: ${role}` : ""}${detail ? `: ${detail}` : ""}). Map the account, then ${RETRY_HINT[kind]}.`,
        metadata: { docId, kind: `van_${kind}`, reason, role, ...(canvasserId ? { canvasserId } : {}) },
      },
    });
  } catch (e) {
    /*
     * Best-effort: a notification failure must never fail the source
     * operation (load/sale/reconcile already committed). But swallowing it
     * silently is worse than it looks here: `hasPostableJournal` gates the
     * retry button on a matching JOURNAL_PENDING notification existing, so
     * if THIS write also fails, the document ends up with no journal, no
     * notification, and no retry button. The hourly van journal sweep
     * (`van-journal-sweep.ts`) re-attempts it from there, but only above its
     * auto-post floor. Log loudly so it is at least discoverable.
     */
    console.error(
      `[postVanJournalSafely] FAILED TO NOTIFY for van ${kind} ${docId} — this document has no journal and will show ` +
        "no retry button (JOURNAL_PENDING notification write also failed). The hourly van journal sweep re-attempts it " +
        "only if it was created at or above the sweep floor.",
      e,
    );
  }

  /**
   * Below the try/catch, not inside it: reaching here means the `AdminNotification` row is
   * committed, so the retry button WILL render — the catch above says the opposite, and a
   * delivery failure must never be able to reach it.
   *
   * Not awaited either. A van sale is a terminal point-of-sale transaction: the canvasser is
   * standing at the counter waiting for the thermal nota, and delivery walks recipients with an
   * FCM call each, which firebase-admin retries for roughly a minute per recipient when the
   * network is unreachable. A finance misconfiguration must not stall the sale any more than it
   * may fail it.
   */
  if (vanJournalNotification) void fanOutAdminNotification(vanJournalNotification);
}

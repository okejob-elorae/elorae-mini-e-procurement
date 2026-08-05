import { prisma } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

/**
 * Posts a van journal without ever failing the caller. A canvassing sale is a
 * terminal point-of-sale transaction: a finance misconfiguration must not fail
 * it in front of a customer, so a problem becomes a JOURNAL_PENDING notification
 * instead of an error.
 */
export async function postVanJournalSafely(
  kind: "load" | "sale" | "reconcile",
  docId: string,
  post: () => Promise<GenerateAutoJournalResult>,
): Promise<void> {
  try {
    const res = await post();
    if (res.ok || res.code === "NOTHING_TO_POST") return;
    await notify(kind, docId, res.code, "role" in res ? (res.role ?? null) : null);
  } catch (e) {
    await notify(kind, docId, "ERROR", null, e instanceof Error ? e.message : "unknown");
  }
}

async function notify(
  kind: string,
  docId: string,
  reason: string,
  role: string | null,
  detail?: string,
): Promise<void> {
  try {
    await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Van ${kind} journal not posted`,
        message: `Van ${kind} journal could not be posted (${reason}${role ? `: ${role}` : ""}${detail ? `: ${detail}` : ""}). Map the account, then retry from the canvassing page.`,
        metadata: { docId, kind: `van_${kind}`, reason, role },
      },
    });
  } catch {
    /* best-effort: a notification failure must never fail the source operation */
  }
}

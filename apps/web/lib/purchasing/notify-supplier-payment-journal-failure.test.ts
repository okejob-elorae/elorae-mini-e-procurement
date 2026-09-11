import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";
import { notifySupplierPaymentJournalFailure } from "./post-supplier-payment-journal-safely";

/* Stubbed so the flag's fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Writes AdminNotification rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type FlaggedRow = { id: string; title: string; message: string; reason: string | undefined };

/**
 * Unread `JOURNAL_PENDING` rows carrying this exact `docId`, read the same way
 * the dedup itself reads them (recent unread rows, matched in JS — this MariaDB
 * adapter's JSON-path filtering is unreliable). Scoped to one synthetic doc id
 * the caller owns, never a global count, because this spec shares the dev DB
 * with real notification rows.
 */
async function flaggedRowsFor(docId: string): Promise<FlaggedRow[]> {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, title: true, message: true, metadata: true },
  });
  return recent
    .filter((n) => (n.metadata as { docId?: string } | null)?.docId === docId)
    .map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      reason: (n.metadata as { reason?: string } | null)?.reason,
    }));
}

d("notifySupplierPaymentJournalFailure dedup (test bed only)", () => {
  let docId: string;

  /* A synthetic PO id per test: nothing else in the dev DB can carry it, so
     every assertion and every delete below stays scoped to this spec's rows. */
  beforeEach(() => {
    docId = `po-notify-test-${Math.floor(Math.random() * 10_000_000)}`;
  });

  afterEach(async () => {
    try {
      const rows = await flaggedRowsFor(docId);
      if (rows.length) {
        await prisma.adminNotification.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      }
    } catch (e) {
      console.warn("[notify-supplier-payment-journal-failure.test.ts] failed to delete test notifications", docId, e);
    }
  });

  it("writes one row for a failure and skips a repeat of the SAME reason", async () => {
    await notifySupplierPaymentJournalFailure("payment", docId, { reason: "UNMAPPED_ROLE", role: "AP" });
    await notifySupplierPaymentJournalFailure("payment", docId, { reason: "UNMAPPED_ROLE", role: "AP" });

    const rows = await flaggedRowsFor(docId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("UNMAPPED_ROLE");
  });

  it("writes a second row when the SAME PO now fails for a DIFFERENT reason", async () => {
    /*
     * The misdirection this dedup shape exists to prevent: the operator maps the
     * account, re-marks, and the post fails a different way. Deduping on
     * `(docId, kind)` alone would suppress this row and leave only the unread
     * UNMAPPED_ROLE message telling them to do what they already did.
     */
    await notifySupplierPaymentJournalFailure("payment", docId, { reason: "UNMAPPED_ROLE", role: "AP" });
    await notifySupplierPaymentJournalFailure("payment", docId, { reason: "GRN_JOURNALS_INCOMPLETE", role: null });

    const rows = await flaggedRowsFor(docId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.reason))).toEqual(new Set(["UNMAPPED_ROLE", "GRN_JOURNALS_INCOMPLETE"]));

    /* The new row carries the new remedy, not a copy of the old one. */
    const incomplete = rows.find((r) => r.reason === "GRN_JOURNALS_INCOMPLETE");
    expect(incomplete?.title).toContain("no GRN journal");
    expect(incomplete?.message).toContain("Post the missing GRN journal");
  });

  it("keeps each distinct reason to a single row across repeats", async () => {
    for (const reason of ["GRN_REVERSAL_MISSING", "AP_ACCOUNT_MISMATCH", "GRN_REVERSAL_MISSING"]) {
      await notifySupplierPaymentJournalFailure("payment", docId, { reason, role: null });
    }
    await notifySupplierPaymentJournalFailure("payment", docId, { reason: "AP_ACCOUNT_MISMATCH", role: null });

    const rows = await flaggedRowsFor(docId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.reason))).toEqual(new Set(["GRN_REVERSAL_MISSING", "AP_ACCOUNT_MISMATCH"]));
  });
});

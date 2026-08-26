import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";
import { isArJournalRetryable, findPostableArJournalDocIds } from "./journal-pending";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("journal-pending gating (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const flaggedDoc = `test-ar-flagged-${token}`;
  const cleanDoc = `test-ar-clean-${token}`;
  let notificationId = "";

  afterEach(async () => {
    if (notificationId !== "") {
      await prisma.adminNotification.delete({ where: { id: notificationId } }).catch(() => undefined);
      notificationId = "";
    }
  });

  it("does not offer a retry for a document that was never flagged", async () => {
    expect(await isArJournalRetryable("field_delivery_revenue", cleanDoc)).toBe(false);
  });

  it("offers a retry only once a JOURNAL_PENDING notification exists", async () => {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `test ${token}`,
        message: "test",
        metadata: { docId: flaggedDoc, kind: "field_delivery_revenue", reason: "UNMAPPED_ROLE", role: "AR" },
      },
    });
    notificationId = n.id;
    expect(await isArJournalRetryable("field_delivery_revenue", flaggedDoc)).toBe(true);
  });

  it("does not cross kinds", async () => {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `test ${token}`,
        message: "test",
        metadata: { docId: flaggedDoc, kind: "field_delivery_revenue", reason: "UNBALANCED", role: null },
      },
    });
    notificationId = n.id;
    expect(await isArJournalRetryable("field_delivery_cogs", flaggedDoc)).toBe(false);
  });

  /**
   * The "without querying" half is the part worth pinning, and only the spy can see it. Asserting
   * the empty Set alone passes with the `docIds.length === 0` short-circuit DELETED — the findMany
   * would run, `idSet` would be empty, `flagged` would stay empty and the assertion would still
   * hold. Since that query is an unfiltered scan of every JOURNAL_PENDING row, a silently removed
   * short-circuit is a real cost, so the call count is what actually guards it.
   *
   * The spy passes through to the real implementation rather than mocking it, so it only observes.
   * Restored in a `finally` so a failed assertion cannot leak it into the rest of the file.
   */
  it("returns an empty set for an empty id list without querying", async () => {
    const spy = vi.spyOn(prisma.adminNotification, "findMany");
    try {
      expect(await findPostableArJournalDocIds("ar_payment", [])).toEqual(new Set());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

import { describe, it, expect, afterEach } from "vitest";
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

  it("returns an empty set for an empty id list without querying", async () => {
    expect(await findPostableArJournalDocIds("ar_payment", [])).toEqual(new Set());
  });
});

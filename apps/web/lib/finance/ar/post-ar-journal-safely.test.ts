import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postArJournalSafely } from "./post-ar-journal-safely";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postArJournalSafely (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const docId = `test-ar-doc-${token}`;

  beforeEach(async () => {
    await prisma.adminNotification.deleteMany({ where: { category: "JOURNAL_PENDING", title: { contains: token } } });
  });

  afterEach(async () => {
    const rows = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      select: { id: true, metadata: true },
    });
    const mine = rows.filter((r) => (r.metadata as { docId?: string } | null)?.docId === seededId(docId));
    for (const r of mine) await prisma.adminNotification.delete({ where: { id: r.id } });
  });

  const flaggedCount = async () => {
    const rows = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      select: { metadata: true },
    });
    return rows.filter((r) => (r.metadata as { docId?: string } | null)?.docId === docId).length;
  };

  it("writes nothing when the post succeeds", async () => {
    await postArJournalSafely("ar_payment", docId, async () => ({ ok: true, journalId: "j1", created: true }));
    expect(await flaggedCount()).toBe(0);
  });

  it("writes nothing for NOTHING_TO_POST", async () => {
    await postArJournalSafely("ar_payment", docId, async () => ({ ok: false, code: "NOTHING_TO_POST" }));
    expect(await flaggedCount()).toBe(0);
  });

  it("flags an unmapped role once, not twice for the same reason", async () => {
    const post = async () => ({ ok: false as const, code: "UNMAPPED_ROLE" as const, role: "AR" });
    await postArJournalSafely("ar_payment", docId, post);
    await postArJournalSafely("ar_payment", docId, post);
    expect(await flaggedCount()).toBe(1);
  });

  it("flags again when the reason changes", async () => {
    await postArJournalSafely("ar_payment", docId, async () => ({ ok: false, code: "UNMAPPED_ROLE", role: "AR" }));
    await postArJournalSafely("ar_payment", docId, async () => ({ ok: false, code: "UNBALANCED" }));
    expect(await flaggedCount()).toBe(2);
  });

  it("does not throw when the post itself throws", async () => {
    await expect(
      postArJournalSafely("ar_payment", docId, async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
    expect(await flaggedCount()).toBe(1);
  });

  it("keeps kinds separate for the same document", async () => {
    const post = async () => ({ ok: false as const, code: "UNBALANCED" as const });
    await postArJournalSafely("field_delivery_revenue", docId, post);
    await postArJournalSafely("field_delivery_cogs", docId, post);
    expect(await flaggedCount()).toBe(2);
  });
});

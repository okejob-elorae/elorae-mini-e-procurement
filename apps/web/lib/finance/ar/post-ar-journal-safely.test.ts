import { describe, it, expect, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postArJournalSafely } from "./post-ar-journal-safely";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postArJournalSafely (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const docId = `test-ar-doc-${token}`;

  /**
   * No pre-clean hook. The one that used to sit here filtered `title: { contains: token }`, but
   * `title` is a fixed literal from `TITLE[kind]` and never contains the token, so it deleted
   * nothing and bought no isolation — while being exactly the `contains` shape this repo forbids on
   * a shared table: a `token` of `""` makes `contains: ""` match every row and wipe every
   * JOURNAL_PENDING notification on the test bed. The `afterEach` below is the real isolation: it
   * matches on `metadata.docId` in JS, and `docId` embeds the per-run token.
   */
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

  it("does not throw when the post itself throws, and reports ERROR", async () => {
    await expect(
      postArJournalSafely("ar_payment", docId, async () => {
        throw new Error("boom");
      }),
    ).resolves.toEqual({ ok: false, code: "ERROR" });
    expect(await flaggedCount()).toBe(1);
  });

  it("keeps kinds separate for the same document", async () => {
    const post = async () => ({ ok: false as const, code: "UNBALANCED" as const });
    await postArJournalSafely("field_delivery_revenue", docId, post);
    await postArJournalSafely("field_delivery_cogs", docId, post);
    expect(await flaggedCount()).toBe(2);
  });

  /*
   * The four cases below pin the return CONTRACT itself: `postArJournalSafely` now returns the
   * outcome it computes rather than `void`, because a caller (the field-delivery journal retry
   * action) needs to tell "posted" from "attempted and flagged again" and cannot substitute a
   * `isArJournalRetryable` re-check for that — the gate ignores `readAt` and nothing ever clears a
   * `JOURNAL_PENDING` row, so a re-check after a genuinely successful retry still reads "pending".
   */
  it("returns the outcome unchanged when the post succeeds", async () => {
    const outcome = await postArJournalSafely("ar_payment", docId, async () => ({
      ok: true,
      journalId: "j1",
      created: true,
    }));
    expect(outcome).toEqual({ ok: true, journalId: "j1", created: true });
  });

  it("returns the NOTHING_TO_POST outcome unchanged", async () => {
    const outcome = await postArJournalSafely("ar_payment", docId, async () => ({
      ok: false,
      code: "NOTHING_TO_POST",
    }));
    expect(outcome).toEqual({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("returns the UNMAPPED_ROLE outcome unchanged", async () => {
    const outcome = await postArJournalSafely("ar_payment", docId, async () => ({
      ok: false,
      code: "UNMAPPED_ROLE",
      role: "AR",
    }));
    expect(outcome).toEqual({ ok: false, code: "UNMAPPED_ROLE", role: "AR" });
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postVanJournalSafely } from "./post-van-journal-safely";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postVanJournalSafely (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const docId = `test-van-doc-${token}`;

  /* Matches on metadata.docId in JS (docId embeds the per-run token) and deletes each row by id. */
  afterEach(async () => {
    const rows = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      select: { id: true, metadata: true },
    });
    const mine = rows.filter((r) => (r.metadata as { docId?: string } | null)?.docId === seededId(docId));
    for (const r of mine) await prisma.adminNotification.delete({ where: { id: r.id } });
  });

  const flaggedMetadata = async () => {
    const rows = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      select: { metadata: true },
    });
    return rows
      .map((r) => r.metadata as Record<string, unknown> | null)
      .filter((m) => m?.docId === docId);
  };

  const failedPost = async () => ({ ok: false as const, code: "UNBALANCED" as const });

  it("writes a load row without canvasserId when the load does not exist", async () => {
    await postVanJournalSafely("load", docId, failedPost);
    const [meta] = await flaggedMetadata();
    expect(meta).toMatchObject({ docId, kind: "van_load" });
    expect(meta).not.toHaveProperty("canvasserId");
  });

  it("records the canvasserId a load lookup finds", async () => {
    const canvasserId = `test-canvasser-${token}`;
    const original = prisma.vanLoad.findUnique.bind(prisma.vanLoad);
    const spy = vi.spyOn(prisma.vanLoad, "findUnique").mockImplementation(
      (async () => ({ canvasserId })) as unknown as typeof prisma.vanLoad.findUnique,
    );
    try {
      await postVanJournalSafely("load", docId, failedPost);
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.vanLoad.findUnique);
    }
    const [meta] = await flaggedMetadata();
    expect(meta).toMatchObject({ docId, kind: "van_load", canvasserId });
  });

  it("still writes the row when the load lookup fails", async () => {
    const original = prisma.vanLoad.findUnique.bind(prisma.vanLoad);
    const spy = vi.spyOn(prisma.vanLoad, "findUnique").mockImplementation(
      (async () => {
        throw new Error("lookup down");
      }) as unknown as typeof prisma.vanLoad.findUnique,
    );
    try {
      await postVanJournalSafely("load", docId, failedPost);
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.vanLoad.findUnique);
    }
    const [meta] = await flaggedMetadata();
    expect(meta).toMatchObject({ docId, kind: "van_load", reason: "UNBALANCED" });
    expect(meta).not.toHaveProperty("canvasserId");
  });
});

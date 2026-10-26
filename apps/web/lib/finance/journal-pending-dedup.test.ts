import { describe, it, expect, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { hasJournalPendingRow } from "./journal-pending-dedup";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("hasJournalPendingRow (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let ids: string[] = [];

  afterEach(async () => {
    await prisma.adminNotification.deleteMany({ where: { id: { in: ids.map(seededId) } } });
    ids = [];
  });

  const file = async (metadata: Record<string, string>, extra: { readAt?: Date; createdAt?: Date } = {}) => {
    const row = await prisma.adminNotification.create({
      data: { category: "JOURNAL_PENDING", severity: "WARNING", title: `test ${token}`, message: "test", metadata, ...extra },
    });
    ids.push(row.id);
    return row;
  };

  it("finds a matching unread row", async () => {
    await file({ docId: `doc-${token}`, kind: "k" });
    expect(await hasJournalPendingRow((m) => m.docId === `doc-${token}` && m.kind === "k")).toBe(true);
  });

  it("finds nothing for an identity no row carries", async () => {
    await file({ docId: `doc-${token}`, kind: "k" });
    expect(await hasJournalPendingRow((m) => m.docId === `other-${token}`)).toBe(false);
  });

  it("finds a READ row that is older than 200 newer rows", async () => {
    const old = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    await file({ docId: `old-${token}`, kind: "k" }, { readAt: new Date(), createdAt: old });
    const newer = Array.from({ length: 205 }, () => ({
      category: "JOURNAL_PENDING",
      severity: "WARNING" as const,
      title: `test ${token}`,
      message: "test",
      metadata: { docId: `filler-${token}`, kind: "k" },
    }));
    const created = await Promise.all(newer.map((data) => prisma.adminNotification.create({ data })));
    ids.push(...created.map((r) => r.id));
    expect(await hasJournalPendingRow((m) => m.docId === `old-${token}`)).toBe(true);
  });

  it("ignores rows of other categories", async () => {
    const row = await prisma.adminNotification.create({
      data: { category: "AR_OVERDUE", severity: "WARNING", title: `test ${token}`, message: "test", metadata: { docId: `cat-${token}` } },
    });
    ids.push(row.id);
    expect(await hasJournalPendingRow((m) => m.docId === `cat-${token}`)).toBe(false);
  });
});

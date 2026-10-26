import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { hasJournalPendingRow } from "./journal-pending-dedup";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("hasJournalPendingRow (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);

  /* Every row this spec creates carries the per-run title, so cleanup filters on it and nothing else. */
  afterEach(async () => {
    await prisma.adminNotification.deleteMany({ where: { title: `test ${token}` } });
  });

  const row = (
    metadata: Record<string, string>,
    extra: { readAt?: Date; createdAt?: Date; category?: string } = {},
  ) => ({
    category: extra.category ?? "JOURNAL_PENDING",
    severity: "WARNING" as const,
    title: `test ${token}`,
    message: "test",
    metadata,
    ...(extra.readAt ? { readAt: extra.readAt } : {}),
    ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
  });

  const file = (metadata: Record<string, string>, extra: Parameters<typeof row>[1] = {}) =>
    prisma.adminNotification.create({ data: row(metadata, extra) });

  it("finds a matching unread row", async () => {
    await file({ docId: `doc-${token}`, kind: "k" });
    expect(await hasJournalPendingRow((m) => m.docId === `doc-${token}` && m.kind === "k")).toBe(true);
    expect(await hasJournalPendingRow((m) => m.docId === `doc-${token}` && m.kind === "k", { unreadOnly: true })).toBe(true);
  });

  it("finds nothing for an identity no row carries", async () => {
    await file({ docId: `doc-${token}`, kind: "k" });
    expect(await hasJournalPendingRow((m) => m.docId === `other-${token}`)).toBe(false);
  });

  it("finds a READ row that is older than 200 newer rows", async () => {
    const old = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    await file({ docId: `old-${token}`, kind: "k" }, { readAt: new Date(), createdAt: old });
    await prisma.adminNotification.createMany({
      data: Array.from({ length: 205 }, () => row({ docId: `filler-${token}`, kind: "k" })),
    });
    expect(await hasJournalPendingRow((m) => m.docId === `old-${token}`)).toBe(true);
  });

  it("unreadOnly ignores a READ match but still sees an unread one beneath 205 newer rows", async () => {
    const old = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    await file({ docId: `read-${token}`, kind: "k" }, { readAt: new Date() });
    await file({ docId: `unread-${token}`, kind: "k" }, { createdAt: old });
    await prisma.adminNotification.createMany({
      data: Array.from({ length: 205 }, () => row({ docId: `filler-${token}`, kind: "k" })),
    });
    expect(await hasJournalPendingRow((m) => m.docId === `read-${token}`, { unreadOnly: true })).toBe(false);
    expect(await hasJournalPendingRow((m) => m.docId === `read-${token}`)).toBe(true);
    expect(await hasJournalPendingRow((m) => m.docId === `unread-${token}`, { unreadOnly: true })).toBe(true);
  });

  it("ignores rows of other categories", async () => {
    await file({ docId: `cat-${token}` }, { category: "AR_OVERDUE" });
    expect(await hasJournalPendingRow((m) => m.docId === `cat-${token}`)).toBe(false);
  });
});

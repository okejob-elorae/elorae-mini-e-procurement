import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { postJournal } from "./journal-writer";
import { seededId } from "./spec-teardown";

// Ledger-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postJournal (test bed only)", () => {
  let token = ""; // unique per test → no cross-test / leaked-row collision on email or code
  let adminId = "";
  let kasParentId = "";
  let aId = ""; // postable leaf under Kas/Bank
  let bebanParentId = "";
  let bId = ""; // postable leaf under Beban

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    adminId = "";
    kasParentId = "";
    aId = "";
    bebanParentId = "";
    bId = "";

    token = Math.floor(Math.random() * 10_000_000).toString(); // digits only — CoA codes are numeric
    const user = await prisma.user.create({
      data: { email: `test-journal-${token}@test.local`, name: "Test Admin" },
    });
    adminId = user.id;

    const kasParent = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Kas & Bank (test)", type: "ASET", depth: 1, isActive: true },
    });
    kasParentId = kasParent.id;
    const kasLeaf = await prisma.chartAccount.create({
      data: { code: `9${token}11`, name: "Kas Test", type: "ASET", parentId: kasParentId, depth: 2, isActive: true },
    });
    aId = kasLeaf.id;

    const bebanParent = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Beban (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    bebanParentId = bebanParent.id;
    const bebanLeaf = await prisma.chartAccount.create({
      data: { code: `9${token}21`, name: "Beban Test", type: "BEBAN", parentId: bebanParentId, depth: 2, isActive: true },
    });
    bId = bebanLeaf.id;
  });

  afterEach(async () => {
    await prisma.journalLine.deleteMany({ where: { chartAccountId: { in: [seededId(aId), seededId(bId)] } } });
    await prisma.journal.deleteMany({ where: { postedById: seededId(adminId) } });
    // Delete leaf children BEFORE their parents — the CoaParent self-FK (onDelete: NoAction)
    // blocks removing a parent while a child still references it.
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(aId), seededId(bId)] } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kasParentId), seededId(bebanParentId)] } } });
    await prisma.user.deleteMany({ where: { id: seededId(adminId) } });
  });

  it("posts a balanced journal", async () => {
    const r = await postJournal(prisma, {
      date: new Date(),
      description: "t",
      postedById: adminId,
      lines: [
        { chartAccountId: aId, debit: 1000, credit: 0 },
        { chartAccountId: bId, debit: 0, credit: 1000 },
      ],
    });
    expect(r.created).toBe(true);
    const j = await prisma.journal.findUnique({ where: { id: r.journalId }, include: { lines: true } });
    expect(j!.lines).toHaveLength(2);
  });

  it("rejects unbalanced", async () => {
    await expect(
      postJournal(prisma, {
        date: new Date(),
        description: "t",
        postedById: adminId,
        lines: [
          { chartAccountId: aId, debit: 1000, credit: 0 },
          { chartAccountId: bId, debit: 0, credit: 999 },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNBALANCED" });
  });

  it("rejects a non-postable (parent) account", async () => {
    await expect(
      postJournal(prisma, {
        date: new Date(),
        description: "t",
        postedById: adminId,
        lines: [
          { chartAccountId: kasParentId, debit: 1000, credit: 0 },
          { chartAccountId: bId, debit: 0, credit: 1000 },
        ],
      }),
    ).rejects.toMatchObject({ code: "NON_POSTABLE_ACCOUNT" });
  });

  it("is idempotent by source", async () => {
    const src = { type: "TEST", id: `s-${Math.random().toString(36).slice(2)}` };
    const a1 = await postJournal(prisma, {
      date: new Date(),
      description: "t",
      postedById: adminId,
      source: src,
      lines: [
        { chartAccountId: aId, debit: 5, credit: 0 },
        { chartAccountId: bId, debit: 0, credit: 5 },
      ],
    });
    const a2 = await postJournal(prisma, {
      date: new Date(),
      description: "t",
      postedById: adminId,
      source: src,
      lines: [
        { chartAccountId: aId, debit: 5, credit: 0 },
        { chartAccountId: bId, debit: 0, credit: 5 },
      ],
    });
    expect(a2.created).toBe(false);
    expect(a2.journalId).toBe(a1.journalId);
  });

  it("stores cents-rounded values and stays exactly balanced", async () => {
    const r = await postJournal(prisma, {
      date: new Date(),
      description: "round",
      postedById: adminId,
      lines: [
        { chartAccountId: aId, debit: 33.334, credit: 0 },
        { chartAccountId: bId, debit: 0, credit: 33.33 },
      ],
    });
    // 33.334 → 33.33; both sides 33.33 → balanced + stored rounded
    const j = await prisma.journal.findUnique({ where: { id: r.journalId }, include: { lines: true } });
    const dr = j!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = j!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr); // exactly, post-round
  });

  it("rejects an imbalance that only appears after cents rounding", async () => {
    // 33.33 + 33.33 + 33.34 = 100.00 debit vs 100.005 credit → credit rounds 100.01 ≠ 100.00
    await expect(
      postJournal(prisma, {
        date: new Date(),
        description: "x",
        postedById: adminId,
        lines: [
          { chartAccountId: aId, debit: 100, credit: 0 },
          { chartAccountId: bId, debit: 0, credit: 100.005 },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNBALANCED" });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { generateAutoJournal } from "./journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "./journals/mapping-test-fixture";

// Posts journal + mapping rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("generateAutoJournal (test bed only)", () => {
  let token = "";
  let userId = "";
  let inventoryId = "";
  let varianceId = "";
  let mappingSnapshot: MappingSnapshot;
  const sourceId = () => `test-src-${token}`;

  beforeEach(async () => {
    /* Kosongkan dulu: hook yang gagal di tengah hanya membersihkan yang benar-benar dibuatnya. */
    userId = "";
    inventoryId = "";
    varianceId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(["INVENTORY", "INVENTORY_VARIANCE"]);
    const user = await prisma.user.create({
      data: { email: `test-auto-journal-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;

    const inventory = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Inventory (test)", type: "ASET", depth: 1, isActive: true },
    });
    inventoryId = inventory.id;
    const variance = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Inventory Variance (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    varianceId = variance.id;

    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY" },
      create: { role: "INVENTORY", chartAccountId: inventoryId },
      update: { chartAccountId: inventoryId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "INVENTORY_VARIANCE" },
      create: { role: "INVENTORY_VARIANCE", chartAccountId: varianceId },
      update: { chartAccountId: varianceId },
    });
  });

  afterEach(async () => {
    const journals = await prisma.journal.findMany({
      where: { postedById: seededId(userId) },
      select: { id: true },
    });
    const journalIds = journals.map((j) => j.id);
    if (journalIds.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(journalIds) } } });
      await prisma.journal.deleteMany({ where: { id: { in: seededIds(journalIds) } } });
    }
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(inventoryId), seededId(varianceId)] } } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("resolves roles and posts a balanced journal", async () => {
    const r = await generateAutoJournal(
      prisma,
      "TEST",
      sourceId(),
      [
        { role: "INVENTORY", debit: 100, credit: 0 },
        { role: "INVENTORY_VARIANCE", debit: 0, credit: 100 },
      ],
      { date: new Date(), description: "test", postedById: userId },
    );
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "TEST", sourceId: sourceId() } },
      include: { lines: true },
    });
    expect(j!.lines).toHaveLength(2);
    const totalDebit = j!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = j!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("persists the channel and store dimensions on each line; lines without them stay null", async () => {
    const r = await generateAutoJournal(
      prisma,
      "TEST",
      sourceId(),
      [
        { role: "INVENTORY", debit: 300, credit: 0, channel: "KONSINYASI", storeId: "toko-uji-kanal" },
        { role: "INVENTORY_VARIANCE", debit: 0, credit: 200, channel: "SHOPEE" },
        { role: "INVENTORY_VARIANCE", debit: 0, credit: 100 },
      ],
      { date: new Date(), description: "test", postedById: userId },
    );
    expect(r).toMatchObject({ ok: true, created: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "TEST", sourceId: sourceId() } },
      include: { lines: { orderBy: [{ debit: "desc" }, { credit: "desc" }] } },
    });
    expect(j!.status).toBe("POSTED");
    expect(j!.lines.map((l) => [Number(l.debit), Number(l.credit), l.channel, l.storeId])).toEqual([
      [300, 0, "KONSINYASI", "toko-uji-kanal"],
      [0, 200, "SHOPEE", null],
      [0, 100, null, null],
    ]);
  });

  it("returns NOTHING_TO_POST for empty lines", async () => {
    const r = await generateAutoJournal(prisma, "TEST", sourceId(), [], {
      date: new Date(),
      description: "test",
      postedById: userId,
    });
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("returns UNMAPPED_ROLE when a role has no mapping", async () => {
    await prisma.journalAccountMapping.delete({ where: { role: "INVENTORY_VARIANCE" } });
    const r = await generateAutoJournal(
      prisma,
      "TEST",
      sourceId(),
      [
        { role: "INVENTORY", debit: 100, credit: 0 },
        { role: "INVENTORY_VARIANCE", debit: 0, credit: 100 },
      ],
      { date: new Date(), description: "test", postedById: userId },
    );
    expect(r).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "INVENTORY_VARIANCE" });
  });

  it("is idempotent by source (re-post returns created:false)", async () => {
    const lines = [
      { role: "INVENTORY" as const, debit: 100, credit: 0 },
      { role: "INVENTORY_VARIANCE" as const, debit: 0, credit: 100 },
    ];
    const meta = { date: new Date(), description: "test", postedById: userId };
    const a = await generateAutoJournal(prisma, "TEST", sourceId(), lines, meta);
    const b = await generateAutoJournal(prisma, "TEST", sourceId(), lines, meta);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
    if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
  });
});

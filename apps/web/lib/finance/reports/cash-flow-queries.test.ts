import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  getCashOpeningBalance,
  getSectionByAccountId,
  listAccountSections,
} from "./cash-flow-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("cash flow account queries (test bed only)", () => {
  let token = "";
  let parentId = "";
  let cashId = "";
  let inactiveId = "";
  let plainId = "";
  let otherId = "";
  let mappingId = "";
  let journalIds: string[] = [];
  let mappedRole = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    parentId = "";
    cashId = "";
    inactiveId = "";
    plainId = "";
    otherId = "";
    mappingId = "";
    journalIds = [];
    mappedRole = `SPEC_CFQ_${token}`;

    const parent = await prisma.chartAccount.create({
      data: { code: `CFQ-${token}-0`, name: "cfq parent", type: "ASET", depth: 1 },
    });
    parentId = parent.id;

    const cash = await prisma.chartAccount.create({
      data: {
        code: `CFQ-${token}-1`,
        name: "cfq cash",
        type: "ASET",
        depth: 2,
        parentId,
        cashFlowSection: "KAS",
      },
    });
    cashId = cash.id;

    const inactive = await prisma.chartAccount.create({
      data: {
        code: `CFQ-${token}-2`,
        name: "cfq old bank",
        type: "ASET",
        depth: 2,
        parentId,
        isActive: false,
        cashFlowSection: "KAS",
      },
    });
    inactiveId = inactive.id;

    const plain = await prisma.chartAccount.create({
      data: { code: `CFQ-${token}-3`, name: "cfq plain", type: "LIABILITAS", depth: 2, parentId },
    });
    plainId = plain.id;

    const other = await prisma.chartAccount.create({
      data: { code: `CFQ-${token}-4`, name: "cfq other", type: "ASET", depth: 2, parentId },
    });
    otherId = other.id;

    const mapping = await prisma.journalAccountMapping.create({
      data: { role: mappedRole, chartAccountId: plainId },
    });
    mappingId = mapping.id;
  });

  afterEach(async () => {
    await prisma.journal.deleteMany({ where: { id: { in: journalIds.map(seededId) } } });
    await prisma.journalAccountMapping.deleteMany({ where: { id: seededId(mappingId) } });
    /* Children before the parent: the parent relation is NoAction. */
    await prisma.chartAccount.deleteMany({
      where: {
        id: { in: [cashId, inactiveId, plainId, otherId].map(seededId) },
      },
    });
    await prisma.chartAccount.deleteMany({ where: { id: seededId(parentId) } });
  });

  async function postJournal(
    date: string,
    lines: Array<{ accountId: string; debit: number; credit: number }>,
  ) {
    const journal = await prisma.journal.create({
      data: {
        date: new Date(date),
        description: `cfq spec ${token}`,
        postedById: "cfq-spec",
        lines: {
          create: lines.map((line) => ({
            chartAccountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
          })),
        },
      },
    });
    journalIds.push(journal.id);
  }

  describe("listAccountSections", () => {
    it("lists leaves with their override and mapped roles, and omits the parent", async () => {
      const rows = await listAccountSections();
      const mine = rows.filter((row) =>
        [parentId, cashId, inactiveId, plainId, otherId].includes(row.accountId),
      );

      expect(mine.map((row) => row.accountId).sort()).toEqual(
        [cashId, inactiveId, plainId, otherId].sort(),
      );

      const cash = mine.find((row) => row.accountId === cashId);
      expect(cash?.override).toBe("KAS");
      expect(cash?.isActive).toBe(true);

      const inactive = mine.find((row) => row.accountId === inactiveId);
      expect(inactive?.override).toBe("KAS");
      expect(inactive?.isActive).toBe(false);

      const plain = mine.find((row) => row.accountId === plainId);
      expect(plain?.override).toBeNull();
      expect(plain?.roles).toEqual([mappedRole]);

      const other = mine.find((row) => row.accountId === otherId);
      expect(other?.override).toBeNull();
      expect(other?.roles).toEqual([]);
    });
  });

  describe("getSectionByAccountId", () => {
    it("resolves the override, keeps the inactive leaf, and omits the parent", async () => {
      const sections = await getSectionByAccountId();

      expect(sections.get(cashId)).toBe("KAS");
      expect(sections.get(inactiveId)).toBe("KAS");
      expect(sections.has(parentId)).toBe(false);
      expect(sections.has(plainId)).toBe(true);
      expect(sections.has(otherId)).toBe(true);
    });
  });

  describe("getCashOpeningBalance", () => {
    it("returns zero without a boundary or without cash accounts", async () => {
      await postJournal("2001-03-10T05:00:00.000Z", [
        { accountId: cashId, debit: 1000, credit: 0 },
        { accountId: otherId, debit: 0, credit: 1000 },
      ]);

      expect(await getCashOpeningBalance(undefined, [cashId])).toBe(0);
      expect(await getCashOpeningBalance(new Date("2001-12-31T00:00:00.000Z"), [])).toBe(0);
    });

    it("sums debit minus credit before the boundary across the given accounts only", async () => {
      await postJournal("2001-03-10T05:00:00.000Z", [
        { accountId: cashId, debit: 1000.1, credit: 0 },
        { accountId: otherId, debit: 0, credit: 1000.1 },
      ]);
      await postJournal("2001-04-10T05:00:00.000Z", [
        { accountId: inactiveId, debit: 0, credit: 200.05 },
        { accountId: otherId, debit: 200.05, credit: 0 },
      ]);
      await postJournal("2002-01-10T05:00:00.000Z", [
        { accountId: cashId, debit: 5000, credit: 0 },
        { accountId: otherId, debit: 0, credit: 5000 },
      ]);

      const before = new Date("2001-12-31T00:00:00.000Z");

      expect(await getCashOpeningBalance(before, [cashId, inactiveId])).toBe(800.05);
      expect(await getCashOpeningBalance(before, [cashId])).toBe(1000.1);
      expect(
        await getCashOpeningBalance(new Date("2002-12-31T00:00:00.000Z"), [cashId, inactiveId]),
      ).toBe(5800.05);
    });

    it("includes a journal dated exactly on the boundary", async () => {
      await postJournal("2001-06-01T00:00:00.000Z", [
        { accountId: cashId, debit: 300, credit: 0 },
        { accountId: otherId, debit: 0, credit: 300 },
      ]);

      expect(await getCashOpeningBalance(new Date("2001-06-01T00:00:00.000Z"), [cashId])).toBe(300);
      expect(await getCashOpeningBalance(new Date("2001-05-31T23:59:59.999Z"), [cashId])).toBe(0);
    });
  });
});

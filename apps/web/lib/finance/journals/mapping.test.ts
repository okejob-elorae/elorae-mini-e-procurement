import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { resolveAccount, listAccountMappings, setAccountMapping, UnmappedRoleError } from "./mapping";

// Mutates JournalAccountMapping + seeds ChartAccount rows — never run against the shared prod DB.
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("mapping (test bed only)", () => {
  const tag = Math.floor(Math.random() * 10_000_000).toString(); // digits only — CoA codes are numeric
  let parentId: string;
  let leafId: string;

  beforeEach(async () => {
    const parent = await prisma.chartAccount.create({
      data: { code: `9${tag}1`, name: "Mapping Parent (test)", type: "ASET", depth: 1, isActive: true },
    });
    parentId = parent.id;
    const leaf = await prisma.chartAccount.create({
      data: { code: `9${tag}11`, name: "Mapping Leaf (test)", type: "ASET", parentId, depth: 2, isActive: true },
    });
    leafId = leaf.id;
  });

  afterEach(async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { chartAccountId: { in: [leafId, parentId] } } });
    // Delete leaf before parent — the CoaParent self-FK (onDelete: NoAction) blocks
    // removing a parent while a child still references it.
    await prisma.chartAccount.deleteMany({ where: { id: leafId } });
    await prisma.chartAccount.deleteMany({ where: { id: parentId } });
  });

  it("resolveAccount returns the mapped account id", async () => {
    await prisma.journalAccountMapping.upsert({
      where: { role: "BANK" },
      create: { role: "BANK", chartAccountId: leafId },
      update: { chartAccountId: leafId },
    });
    expect(await resolveAccount("BANK")).toBe(leafId);
  });

  it("resolveAccount throws UnmappedRoleError when unset", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "COGS" } });
    await expect(resolveAccount("COGS")).rejects.toBeInstanceOf(UnmappedRoleError);
  });

  it("setAccountMapping upserts", async () => {
    await setAccountMapping("AR", leafId, prisma);
    const row = await prisma.journalAccountMapping.findUnique({ where: { role: "AR" } });
    expect(row!.chartAccountId).toBe(leafId);

    // upsert again with the same role updates rather than duplicating.
    await setAccountMapping("AR", leafId, prisma);
    const rows = await prisma.journalAccountMapping.findMany({ where: { role: "AR" } });
    expect(rows).toHaveLength(1);
  });

  it("listAccountMappings returns all posting roles, mapped and unmapped", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "TAX" } });
    await setAccountMapping("TAX", leafId, prisma);

    const rows = await listAccountMappings();
    expect(rows.length).toBeGreaterThanOrEqual(9);

    const taxRow = rows.find((r) => r.role === "TAX");
    expect(taxRow?.chartAccountId).toBe(leafId);
    expect(taxRow?.accountCode).toBe(`9${tag}11`);

    const unmapped = rows.find((r) => r.role !== "TAX" && r.chartAccountId == null);
    expect(unmapped).toBeDefined();
  });
});

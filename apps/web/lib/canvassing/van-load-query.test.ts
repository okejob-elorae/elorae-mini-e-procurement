import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { getVanLoadById } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getVanLoadById (test bed only)", () => {
  const tag = `VLQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let loadId = "";
  let canvasserId = "";
  let adminId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: {
        sku: tag, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000,
        variants: [{ sku: `${tag}-M`, size: "M" }],
      },
    });
    itemId = item.id;
    const canv = await prisma.user.create({ data: { email: `vlq-${tag}@test.local`, name: "Canv" } });
    canvasserId = canv.id;
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    adminId = admin.id;
    const load = await prisma.vanLoad.create({
      data: {
        docNo: `VANLOAD/${tag}`, canvasserId, loadedById: adminId,
        lines: { create: [{ itemId, variantSku: `${tag}-M`, qty: 10, unitCost: 1000 }, { itemId, variantSku: "", qty: 5, unitCost: 1000 }] },
      },
    });
    loadId = load.id;
  });

  afterEach(async () => {
    await prisma.vanLoadLine.deleteMany({ where: { itemId } });
    await prisma.vanLoad.deleteMany({ where: { id: loadId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
    await prisma.user.deleteMany({ where: { id: canvasserId } });
  });

  it("returns lines with variant label for a variant line, null for variantless", async () => {
    const d = await getVanLoadById(loadId);
    expect(d!.docNo).toBe(`VANLOAD/${tag}`);
    const mv = d!.lines.find((l) => l.variantSku === `${tag}-M`);
    expect(mv!.variantLabel).toBe("size: M");
    const plain = d!.lines.find((l) => l.variantSku === "" || l.variantSku === null);
    expect(plain!.variantLabel).toBeNull();
  });
});

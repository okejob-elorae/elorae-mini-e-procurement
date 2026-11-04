import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { getRawMaterialShortage } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * `getRawMaterialShortage` against real rows: the bug lived in WHICH work
 * orders were read and WHICH stock column was compared, so a pure test alone
 * would not catch a regression in the query half.
 *
 * Read-only for every row it did not seed; the assertions look only at the
 * seeded materials. Teardown goes through `seededId()`.
 */
d("getRawMaterialShortage (test bed only)", () => {
  let token = "";
  let userId = "";
  let supplierTypeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let kainId = "";
  let lainId = "";
  let woIds: string[] = [];

  beforeEach(async () => {
    token = "";
    userId = "";
    supplierTypeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    kainId = "";
    lainId = "";
    woIds = [];
    token = `KB${Math.floor(Math.random() * 10_000_000)}`;

    userId = (await prisma.user.create({ data: { email: `${token}@test.local`, name: "Uji Bahan" } })).id;
    supplierTypeId = (await prisma.supplierType.create({ data: { code: `ST-${token}`, name: "Uji" } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `SUP-${token}`, name: `Vendor ${token}`, typeId: supplierTypeId } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${token}`, nameId: "m", nameEn: "m" } })).id;
    const item = (sku: string, type: "FABRIC" | "FINISHED_GOOD") =>
      prisma.item.create({ data: { sku: `${sku}-${token}`, nameId: sku, nameEn: sku, type, isActive: true, uomId } });
    fgId = (await item("FG", "FINISHED_GOOD")).id;
    kainId = (await item("KAIN", "FABRIC")).id;
    lainId = (await item("LAIN", "FABRIC")).id;

    // Stok kain: 30 di tangan, 5 dipesan → TERSEDIA 25.
    await prisma.inventoryValue.create({ data: { itemId: kainId, variantSku: null, qtyOnHand: 30, reservedQty: 5 } });

    const wo = async (n: number, status: "DRAFT" | "IN_PRODUCTION" | "COMPLETED", plan: unknown) => {
      const w = await prisma.workOrder.create({
        data: {
          docNumber: `WO-${token}-${n}`,
          vendorId,
          finishedGoodId: fgId,
          plannedQty: 10,
          status,
          consumptionPlan: JSON.stringify(plan),
          createdById: userId,
          outputMode: "GENERIC",
        },
        select: { id: true },
      });
      woIds.push(w.id);
      return w.id;
    };
    // Sudah dikeluarkan penuh — aturan lama menyebutnya "kurang 100".
    await wo(1, "IN_PRODUCTION", [{ itemId: kainId, plannedQty: 100, issuedQty: 100 }]);
    // Draft: bahannya belum keluar sama sekali — aturan lama tidak melihatnya.
    await wo(2, "DRAFT", [{ itemId: kainId, plannedQty: 40 }]);
    // Selesai: tidak butuh apa-apa lagi.
    await wo(3, "COMPLETED", [{ itemId: lainId, plannedQty: 50 }]);
  });

  afterEach(async () => {
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kainId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([fgId, kainId, lainId].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (vendorId) await prisma.supplier.delete({ where: { id: seededId(vendorId) } });
    if (supplierTypeId) await prisma.supplierType.delete({ where: { id: seededId(supplierTypeId) } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("needs only what is not yet issued, against AVAILABLE stock, across draft work orders too", async () => {
    const hasil = await getRawMaterialShortage();
    const kain = hasil.find((r) => r.itemId === kainId);
    expect(kain).toMatchObject({ totalNeeded: 40, available: 25, deficit: 15, uomCode: `U-${token}` });
    expect(kain!.vendors).toHaveLength(1);
    expect(kain!.vendors[0].workOrders).toEqual([{ woId: woIds[1], docNumber: `WO-${token}-2`, neededQty: 40 }]);
  });

  it("a completed work order never makes a material short", async () => {
    const hasil = await getRawMaterialShortage();
    expect(hasil.find((r) => r.itemId === lainId)).toBeUndefined();
  });
});

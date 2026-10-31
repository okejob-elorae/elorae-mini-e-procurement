import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { reconcileWorkOrder } from "./reconciliation";

/*
 * Rekonsiliasi bahan WO — basis data uji nyata.
 *
 * Dulu `VendorReturn.lines` diperlakukan sebagai array padahal tersimpan
 * sebagai TEKS JSON (jadi bahan kembali selalu 0), dan hanya retur PROCESSED
 * yang dibaca — retur yang sudah COMPLETED (stoknya juga sudah keluar) hilang
 * dari rekonsiliasi. Baris ganda barang yang sama dalam satu dokumen juga
 * hanya dihitung yang pertama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("reconcileWorkOrder (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let kancingId = "";
  let woId = "";

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    kancingId = "";
    woId = "";
    userId = (
      await prisma.user.create({ data: { email: `rekon-wo-${token}@uji.local`, name: "Rekon uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TRK-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-RK-${token}`, name: "CMT rekon", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `R${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-RK-${token}`, nameId: "Kemeja rekon", nameEn: "Recon shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KC-RK-${token}`, nameId: "Kancing rekon", nameEn: "Recon button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    // Rata-rata 1.500: 200 pcs bernilai 300.000.
    await prisma.inventoryValue.create({
      data: { itemId: kancingId, variantSku: "", qtyOnHand: 200, avgCost: 1_500, totalValue: 300_000 },
    });
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-RK-${token}`,
          vendorId,
          finishedGoodId: fgId,
          plannedQty: 100,
          actualQty: 80,
          status: "IN_PRODUCTION",
          createdById: userId,
          consumptionPlan: JSON.stringify([
            { itemId: kancingId, itemName: "Kancing rekon", uomCode: "PCS", qtyRequired: 1, wastePercent: 10, plannedQty: 110, issuedQty: 115, returnedQty: 0 },
          ]),
        },
        select: { id: true },
      })
    ).id;

    // Pengeluaran: 100 + 10 (dua baris barang sama di satu dokumen) + 5 = 115.
    await prisma.materialIssue.create({
      data: {
        docNumber: `ISS-RK-${token}-1`,
        woId,
        issueType: "ACCESSORIES",
        items: JSON.stringify([
          { itemId: kancingId, qty: 100 },
          { itemId: kancingId, qty: 10 },
        ]),
        totalCost: 165_000,
        issuedById: userId,
      },
    });
    await prisma.materialIssue.create({
      data: {
        docNumber: `ISS-RK-${token}-2`,
        woId,
        issueType: "ACCESSORIES",
        items: JSON.stringify([{ itemId: kancingId, qty: 5 }]),
        totalCost: 7_500,
        issuedById: userId,
      },
    });

    const retur = (urut: number, status: "DRAFT" | "PROCESSED" | "COMPLETED", lines: unknown[]) =>
      prisma.vendorReturn.create({
        data: {
          docNumber: `RET-RK-${token}-${urut}`,
          vendorId,
          woId,
          status,
          lines: JSON.stringify(lines),
          totalItems: 0,
          totalValue: 0,
          createdById: userId,
        },
      });
    // Kembali: COMPLETED 6 + PROCESSED (3 + 2) = 11. DRAFT 50 dan baris FG_REJECT 7 tidak dihitung.
    await retur(1, "COMPLETED", [{ type: "ACCESSORIES", itemId: kancingId, qty: 6, costValue: 9_000 }]);
    await retur(2, "PROCESSED", [
      { type: "ACCESSORIES", itemId: kancingId, qty: "3", costValue: 4_500 },
      { type: "ACCESSORIES", itemId: kancingId, qty: 2, costValue: 3_000 },
      { type: "FG_REJECT", itemId: kancingId, qty: 7, costValue: 0 },
    ]);
    await retur(3, "DRAFT", [{ type: "ACCESSORIES", itemId: kancingId, qty: 50, costValue: 75_000 }]);
    // CMT mengembalikan 4 pcs ke gudang ("Kembalikan bahan").
    await prisma.stockAdjustment.create({
      data: {
        docNumber: `ADJ-RK-${token}`,
        itemId: kancingId,
        type: "POSITIVE",
        qtyChange: 4,
        reason: "Kembali bahan uji",
        prevQty: 200,
        newQty: 204,
        prevAvgCost: 1_500,
        newAvgCost: 1_500,
        source: "WO_MATERIAL_RETURN",
        externalRef: woId,
      },
    });
  });

  afterAll(async () => {
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(kancingId) } });
    await prisma.vendorReturn.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.materialIssue.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kancingId, fgId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kancingId, fgId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("bahan keluar 115, kembali 11 retur pemasok (teks JSON, PROCESSED + COMPLETED) + 4 ke gudang → terpakai 100 vs teori 88: lebih 12 (Rp18.000)", async () => {
    const { lines, summary } = await reconcileWorkOrder(woId);
    expect(lines).toHaveLength(1);
    const baris = lines[0];
    expect({
      keluar: baris.issuedQty.toNumber(),
      kembali: baris.returnedQty.toNumber(),
      terpakai: baris.actualUsed.toNumber(),
      teori: baris.theoreticalUsage.toNumber(),
      selisih: baris.variance.toNumber(),
      selisihPersen: baris.variancePercent.toDecimalPlaces(2).toNumber(),
      nilaiSelisih: baris.varianceValue.toNumber(),
      nilaiKeluar: baris.issuedValue.toNumber(),
      nilaiTerpakai: baris.usedValue.toNumber(),
      status: baris.status,
    }).toEqual({
      keluar: 115,
      kembali: 15,
      terpakai: 100,
      teori: 88,
      selisih: 12,
      selisihPersen: 13.64,
      nilaiSelisih: 18_000,
      nilaiKeluar: 172_500,
      nilaiTerpakai: 150_000,
      status: "OVER",
    });
    expect({
      keluar: summary.totalIssuedValue.toNumber(),
      terpakai: summary.totalUsedValue.toNumber(),
      selisih: summary.netVarianceValue.toNumber(),
    }).toEqual({ keluar: 172_500, terpakai: 150_000, selisih: 18_000 });
  });
});

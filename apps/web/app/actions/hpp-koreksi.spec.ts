import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Laporan HPP per perintah kerja memuat selisih harga invoice jasa yang DITERIMA pemilik (P49,
 * 2026-11-01 no. 5: "HPP yang tampil harus HPP sebenarnya … jika 55.000 maka tampak 55.000"):
 * invoice jahit Rp 8.000/pcs atas harga WO Rp 7.500 yang diterima → baris jasa Rp 8.000 dengan
 * catatan "Dikoreksi dari Rp 7.500 (invoice …)". Koreksi yang menunggu, dikoreksi turun ke harga
 * WO, atau dibatalkan (tagihannya dibatalkan) tidak ikut. Sesi ditiru, basis data uji nyata.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "penguji-hpp", email: null, permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { calculateHPP } = await import("./hpp");
const { STATUS_KOREKSI_UTANG } = await import("@/lib/vendor-billing/koreksi-utang-aturan");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("calculateHPP — koreksi harga invoice jasa yang diterima (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let itemId = "";
  let woId = "";
  let stepId = "";
  let billId = "";
  let koreksiId = "";

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    itemId = "";
    woId = "";
    stepId = "";
    billId = "";
    koreksiId = "";
    userId = (await prisma.user.create({ data: { email: `hppk-${token}@uji.local`, name: "Uji HPP koreksi" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `THK-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-HK-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `K${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `FG-HK-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-HK-${token}`,
          vendorId,
          finishedGoodId: itemId,
          plannedQty: 100,
          actualQty: 100,
          consumptionPlan: {},
          createdById: userId,
        },
        select: { id: true },
      })
    ).id;
    stepId = (
      await prisma.workOrderStep.create({
        data: { woId, sequence: 1, stepName: "Jahit", supplierId: vendorId, servicePrice: 7_500, servicePpnIncluded: false },
        select: { id: true },
      })
    ).id;
    billId = (
      await prisma.vendorBill.create({
        data: {
          docNumber: `VB-HK-${token}`,
          supplierId: vendorId,
          vendorInvoiceNo: `INV-JHT-${token}`,
          billDate: new Date("2004-03-01T03:00:00.000Z"),
          total: 800_000,
          createdById: userId,
        },
        select: { id: true },
      })
    ).id;
    koreksiId = (
      await prisma.supplierPayableCorrection.create({
        data: {
          billId,
          billLineId: `vbl-hk-${token}`,
          supplierId: vendorId,
          sourceType: "WO_STEP",
          sourceId: stepId,
          itemId,
          qty: 100,
          recordedPrice: 7_500,
          invoicePrice: 8_000,
          amount: 50_000,
          dppAmount: 50_000,
          ppnInputAmount: 0,
          inventoryAmount: 50_000,
          breakdown: [],
          status: STATUS_KOREKSI_UTANG.MENUNGGU,
          createdById: userId,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.supplierPayableCorrection.deleteMany({ where: { id: seededId(koreksiId) } });
    await prisma.vendorBill.deleteMany({ where: { id: seededId(billId) } });
    await prisma.workOrderStep.deleteMany({ where: { id: seededId(stepId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const ubahStatus = (status: string) =>
    prisma.supplierPayableCorrection.update({ where: { id: seededId(koreksiId) }, data: { status } });

  async function barisJahit() {
    const hpp = await calculateHPP(woId);
    const jasa = hpp.lines.filter((l) => l.category === "SERVICE");
    expect(jasa).toHaveLength(1);
    return { hpp, jasa: jasa[0] };
  }

  it("menunggu keputusan → HPP masih harga WO, tanpa catatan koreksi", async () => {
    await ubahStatus(STATUS_KOREKSI_UTANG.MENUNGGU);
    const { hpp, jasa } = await barisJahit();
    expect(jasa).toMatchObject({ unitCost: 7_500, costPerPcs: 7_500 });
    expect(jasa.koreksi).toBeUndefined();
    expect(hpp.serviceCostPerPcs).toBe(7_500);
  });

  it("diterima → baris jasa Rp 8.000, dikoreksi dari Rp 7.500 dengan nomor invoicenya; HPP/pcs ikut", async () => {
    await ubahStatus(STATUS_KOREKSI_UTANG.DITERIMA);
    const { hpp, jasa } = await barisJahit();
    expect(jasa).toMatchObject({
      unitCost: 8_000,
      costPerPcs: 8_000,
      koreksi: { dari: 7_500, invoiceNo: [`INV-JHT-${token}`] },
    });
    expect(hpp.serviceCostPerPcs).toBe(8_000);
    expect(hpp.subtotal).toBe(8_000);
    // Jasa belum ber-PPN: angka "termasuk PPN" dihitung dari harga yang sudah dikoreksi.
    expect(jasa.nettCostPerPcs).toBeGreaterThan(8_000);
  });

  it.each([
    ["dikoreksi turun ke harga WO", STATUS_KOREKSI_UTANG.INVOICE_DIKOREKSI],
    ["dibatalkan bersama tagihannya", STATUS_KOREKSI_UTANG.DIBATALKAN],
  ])("%s → kembali ke harga WO", async (_label, status) => {
    await ubahStatus(status);
    const { hpp, jasa } = await barisJahit();
    expect(jasa).toMatchObject({ unitCost: 7_500, costPerPcs: 7_500 });
    expect(jasa.koreksi).toBeUndefined();
    expect(hpp.subtotal).toBe(7_500);
  });

  it("invoice yang hanya menagih sebagian pcs dibagi ke seluruh pcs WO", async () => {
    await prisma.supplierPayableCorrection.update({
      where: { id: seededId(koreksiId) },
      data: { status: STATUS_KOREKSI_UTANG.DITERIMA, qty: 40, amount: 20_000, dppAmount: 20_000, inventoryAmount: 20_000 },
    });
    const { jasa } = await barisJahit();
    // 7.500 + 40 × 500 ÷ 100 pcs.
    expect(jasa).toMatchObject({ costPerPcs: 7_700, koreksi: { dari: 7_500 } });
  });
});

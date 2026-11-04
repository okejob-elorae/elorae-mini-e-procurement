import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { batalkanTidakPerluInvoice, tandaiTidakPerluInvoice } from "./tidak-perlu-invoice-writer";
import { bacaTagihanSumber } from "./belum-ditagih-queries";
import { createVendorBill } from "./bill-writer";

/*
 * "Tidak perlu invoice" (keputusan pemilik 2026-11-02, P52: tombol dengan alasan wajib). Basis data uji,
 * GRN sendiri per tes. Pembebasan menghapus pcs dari "Invoice belum ditagih" TANPA mengubah utang, dan
 * invoice yang datang kemudian tetap bisa menagih pcs itu. Tanda dan pembatalannya memakai `updateMany …
 * cek jumlah` / tulis-sesudah-baca di dalam `runSerializable`; tes `Promise.all` membuktikan hanya satu yang
 * menang. Yang lebih pendek digeser beberapa ms supaya tidak selalu kebetulan menang lebih dulu.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("tidak perlu invoice (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", uom: "", item: "", grn: "" };

  beforeEach(async () => {
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
    tag = `TPI${Math.floor(Math.random() * 10_000_000)}`;
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Uji Tidak Perlu" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Uji" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Pemasok uji", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.item = (
      await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId: ids.uom, isActive: true } })
    ).id;
    ids.grn = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-${tag}`,
          supplierId: ids.supplier,
          receivedBy: ids.user,
          totalAmount: 800_000,
          items: [{ itemId: ids.item, variantSku: null, qty: 100, unitCost: 8_000, totalCost: 800_000, itemType: "FINISHED_GOOD" }],
        },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    if (ids.supplier) {
      await prisma.supplierInvoiceWaiver.deleteMany({ where: { supplierId: seededId(ids.supplier) } });
      const bills = (await prisma.vendorBill.findMany({ where: { supplierId: seededId(ids.supplier) }, select: { id: true } })).map((b) => b.id);
      await prisma.supplierPayableCorrection.deleteMany({ where: { billId: { in: seededIds(bills) } } });
      await prisma.vendorBillLine.deleteMany({ where: { billId: { in: seededIds(bills) } } });
      await prisma.vendorBill.deleteMany({ where: { id: { in: seededIds(bills) } } });
    }
    if (ids.grn) await prisma.gRN.deleteMany({ where: { id: seededId(ids.grn) } });
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: seededId(ids.item) } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: seededId(ids.supplier) } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  const sisihkan = (alasan: unknown = "jasa sendiri, tidak ada invoice") =>
    tandaiTidakPerluInvoice({ supplierId: ids.supplier, sumber: [{ jenis: "GRN", id: ids.grn, itemId: ids.item, variantSku: null }], alasan, olehUserId: ids.user });
  const berlaku = () => prisma.supplierInvoiceWaiver.count({ where: { supplierId: seededId(ids.supplier), cancelledAt: null } });
  const belum = async () => (await bacaTagihanSumber(prisma, [{ jenis: "GRN", id: ids.grn }])).get(`GRN|${ids.grn}`)?.belum;
  const jejak = (id: string, action: string) => prisma.auditLog.count({ where: { entityId: seededId(id), action } });

  it("records the waiver at the current uninvoiced qty with its audit row, and takes the receipt off the list", async () => {
    expect(await belum()).toBe(100);
    const r = await sisihkan();
    expect(r).toEqual({ ok: true, ids: [expect.any(String)] });
    if (!r.ok) return;
    const w = await prisma.supplierInvoiceWaiver.findUniqueOrThrow({ where: { id: seededId(r.ids[0]) } });
    expect([w.sourceType, w.sourceId, w.itemId, w.variantSku, Number(w.qty), w.reason, w.createdById]).toEqual([
      "GRN",
      ids.grn,
      ids.item,
      null,
      100,
      "jasa sendiri, tidak ada invoice",
      ids.user,
    ]);
    expect(await jejak(r.ids[0], "SUPPLIER_INVOICE_WAIVED")).toBe(1);
    expect(await belum()).toBe(0);
  });

  it("refuses before any write: no reason, nothing left, a receipt awaiting admin confirmation, another supplier", async () => {
    expect(await sisihkan("   ")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await berlaku()).toBe(0);
    expect((await sisihkan()).ok).toBe(true);
    expect(await sisihkan()).toMatchObject({ ok: false, kode: "TIDAK_ADA_SISA" });
    expect(await berlaku()).toBe(1);
    expect(
      await tandaiTidakPerluInvoice({ supplierId: "pemasok-lain", sumber: [{ jenis: "GRN", id: ids.grn, itemId: ids.item, variantSku: null }], alasan: "x", olehUserId: ids.user }),
    ).toMatchObject({ ok: false, kode: "BUKAN_PEMASOK_INI" });
    expect(await berlaku()).toBe(1);
  });

  it("refuses a receipt without a PO still awaiting admin confirmation (P51a)", async () => {
    await prisma.gRN.update({ where: { id: seededId(ids.grn) }, data: { requiresNoPoConfirmation: true, noPoConfirmedAt: null } });
    expect(await sisihkan()).toMatchObject({ ok: false, kode: "MENUNGGU_KONFIRMASI" });
    expect(await berlaku()).toBe(0);
  });

  it("changes no payable: a later invoice still bills the waived pieces in full", async () => {
    expect((await sisihkan()).ok).toBe(true);
    const bill = await createVendorBill(
      {
        supplierId: ids.supplier,
        vendorInvoiceNo: `INV-${tag}`,
        billDate: new Date("2026-11-03"),
        lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.item, variantSku: null, qty: 100, price: 8_000 }],
      },
      ids.user,
    );
    expect(bill.koreksi).toBe(0);
    const tersimpan = await prisma.vendorBill.findUniqueOrThrow({ where: { id: seededId(bill.id) }, include: { lines: true } });
    expect(tersimpan.lines.map((l) => [l.type, l.grnId, Number(l.qty)])).toEqual([["GRN_ITEM", ids.grn, 100]]);
  });

  it("Batalkan puts the pieces back with its own audit row; a second Batalkan is SUDAH_DIBATALKAN", async () => {
    const r = await sisihkan();
    if (!r.ok) throw new Error("bebaskan gagal");
    expect(await batalkanTidakPerluInvoice({ waiverId: r.ids[0], alasan: "", olehUserId: ids.user })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await batalkanTidakPerluInvoice({ waiverId: r.ids[0], alasan: "ternyata ada invoice", olehUserId: ids.user })).toEqual({ ok: true, ids: [r.ids[0]] });
    const w = await prisma.supplierInvoiceWaiver.findUniqueOrThrow({ where: { id: seededId(r.ids[0]) } });
    expect([w.cancelledById, w.cancelReason]).toEqual([ids.user, "ternyata ada invoice"]);
    expect(await jejak(r.ids[0], "SUPPLIER_INVOICE_WAIVER_CANCELLED")).toBe(1);
    expect(await belum()).toBe(100);
    expect(await batalkanTidakPerluInvoice({ waiverId: r.ids[0], alasan: "lagi", olehUserId: ids.user })).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
    expect(await jejak(r.ids[0], "SUPPLIER_INVOICE_WAIVER_CANCELLED")).toBe(1);
  });

  it("RACE: two waivers on one row at once — exactly one, the other TIDAK_ADA_SISA", async () => {
    const hasil = await Promise.all([sisihkan(), sleep(5).then(() => sisihkan())]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["TIDAK_ADA_SISA"]);
    expect(await berlaku()).toBe(1);
    expect(await belum()).toBe(0);
  });

  it("RACE: two cancellations of one waiver at once — exactly one, one audit row, the other SUDAH_DIBATALKAN", async () => {
    const r = await sisihkan();
    if (!r.ok) throw new Error("bebaskan gagal");
    const hasil = await Promise.all([
      batalkanTidakPerluInvoice({ waiverId: r.ids[0], alasan: "salah", olehUserId: ids.user }),
      sleep(5).then(() => batalkanTidakPerluInvoice({ waiverId: r.ids[0], alasan: "dobel", olehUserId: ids.user })),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIBATALKAN"]);
    expect(await jejak(r.ids[0], "SUPPLIER_INVOICE_WAIVER_CANCELLED")).toBe(1);
    expect(await berlaku()).toBe(0);
  });
});

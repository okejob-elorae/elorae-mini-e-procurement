import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createVendorBill, voidVendorBill } from "./bill-writer";
import { daftarBelumDitagih, hitungPenerimaanBelumDiminta } from "./belum-ditagih-queries";
import { mintaInvoice } from "./permintaan-invoice-writer";

/*
 * "Invoice belum ditagih" (Q18; P19; P51a; P52): setiap penerimaan yang masih punya pcs yang belum
 * disebut invoice, per pemasok. Halaman Belum ditagih dan baris Beranda membaca kueri ini, jadi
 * saringannya diuji terhadap basis data uji: cakupan pemasok (daftar kosong tidak pernah melebar),
 * tagihan hidup dan yang dibatalkan, retur ke pemasok yang selesai, GRN tanpa PO yang menunggu
 * konfirmasi, dan permintaan invoice yang terbuka. Setiap tes membuat dua pemasoknya sendiri; hitungan
 * Beranda dibatasi ke pemasok tes lewat `supplierIds`. "Hari ini" dikirim eksplisit.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/** Penerimaan uji: 20 September 2026 pukul 10.00 WIB. */
const TANGGAL_GRN = new Date("2026-09-20T03:00:00Z");
/** Permintaan invoice dimundurkan ke 1 Oktober 2026 pukul 10.00 WIB — dua hari sebelum "hari ini", belum terlambat. */
const DIMINTA = new Date("2026-10-01T03:00:00Z");
/** "Hari ini" uji (WIB). */
const HARI = "2026-10-03";
const ASOF = new Date("2026-10-03T03:00:00Z");

d("daftarBelumDitagih (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplierA: "", supplierB: "", uom: "", item: "", grnA: "", grnB: "" };
  let poIds: string[] = [];
  let grnIds: string[] = [];

  /** Satu penerimaan 100 pcs @ 8.000 (atau `qty`), lewat PO yang menerima seluruhnya — atau tanpa PO. */
  const penerimaan = async (supplierId: string, huruf: string, opsi: { tanpaPo?: boolean; menungguKonfirmasi?: boolean; qty?: number } = {}) => {
    const qty = opsi.qty ?? 100;
    let poId: string | null = null;
    if (!opsi.tanpaPo) {
      poId = (
        await prisma.purchaseOrder.create({
          data: {
            docNumber: `PO-${tag}-${huruf}`,
            supplierId,
            status: "CLOSED",
            totalAmount: qty * 8_000,
            taxAmount: 0,
            grandTotal: qty * 8_000,
            createdById: ids.user,
            items: { create: [{ itemId: ids.item, qty, price: 8_000, ppnIncluded: true, receivedQty: qty, uomId: ids.uom }] },
          },
          select: { id: true },
        })
      ).id;
      poIds.push(poId);
    }
    const id = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-${tag}-${huruf}`,
          poId,
          supplierId,
          grnDate: TANGGAL_GRN,
          receivedBy: ids.user,
          totalAmount: qty * 8_000,
          items: [{ itemId: ids.item, variantSku: null, qty, unitCost: 8_000, totalCost: qty * 8_000, itemType: "FINISHED_GOOD" }],
          ...(opsi.menungguKonfirmasi ? { requiresNoPoConfirmation: true } : {}),
        },
        select: { id: true },
      })
    ).id;
    grnIds.push(id);
    return id;
  };

  beforeEach(async () => {
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
    poIds = [];
    grnIds = [];
    tag = `BDT${Math.floor(Math.random() * 10_000_000)}`;
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Uji Belum Ditagih" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Uji" } })).id;
    ids.supplierA = (await prisma.supplier.create({ data: { code: `SUPA-${tag}`, name: `Pemasok A ${tag}`, typeId: ids.supplierType } })).id;
    ids.supplierB = (await prisma.supplier.create({ data: { code: `SUPB-${tag}`, name: `Pemasok B ${tag}`, typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.item = (
      await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId: ids.uom, isActive: true } })
    ).id;
    ids.grnA = await penerimaan(ids.supplierA, "A");
    ids.grnB = await penerimaan(ids.supplierB, "B");
  });

  afterEach(async () => {
    const pemasok = [ids.supplierA, ids.supplierB].filter(Boolean);
    if (pemasok.length > 0) {
      const reqIds = (await prisma.supplierInvoiceRequest.findMany({ where: { supplierId: { in: seededIds(pemasok) } }, select: { id: true } })).map((r) => r.id);
      if (reqIds.length > 0) {
        await prisma.supplierInvoiceRequestLine.deleteMany({ where: { requestId: { in: seededIds(reqIds) } } });
        await prisma.supplierInvoiceRequest.deleteMany({ where: { id: { in: seededIds(reqIds) } } });
      }
      await prisma.vendorBillLine.deleteMany({ where: { bill: { supplierId: { in: seededIds(pemasok) } } } });
      await prisma.vendorBill.deleteMany({ where: { supplierId: { in: seededIds(pemasok) } } });
      await prisma.vendorReturn.deleteMany({ where: { vendorId: { in: seededIds(pemasok) } } });
    }
    if (grnIds.length > 0) await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    if (poIds.length > 0) {
      await prisma.pOItem.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    }
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: seededId(ids.item) } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (pemasok.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasok) } } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
    poIds = [];
    grnIds = [];
  });

  const daftar = (o: Omit<Parameters<typeof daftarBelumDitagih>[0], "hariIni">) => daftarBelumDitagih({ ...o, hariIni: HARI });

  it("supplierId scopes the rows and the summary to that supplier", async () => {
    const r = await daftar({ supplierId: ids.supplierA });
    expect(r.baris.map((b) => [b.supplierId, b.jenis, b.id, b.poNomor, b.tanggal, b.umurHari, b.diterima, b.ditagih, b.belum, b.terhalang, b.status])).toEqual([
      [ids.supplierA, "GRN", ids.grnA, `PO-${tag}-A`, "2026-09-20", 13, 100, 0, 100, null, "BELUM_DIMINTA"],
    ]);
    expect(r.ringkasan.map((s) => [s.supplierId, s.penerimaan, s.terpotong])).toEqual([[ids.supplierA, 1, false]]);
  });

  it("supplierIds lists exactly the named suppliers, and an empty list never widens to everyone", async () => {
    const dua = await daftar({ supplierIds: [ids.supplierA, ids.supplierB] });
    expect(dua.baris.map((b) => b.id).sort()).toEqual([ids.grnA, ids.grnB].sort());
    expect(dua.ringkasan.map((s) => s.supplierId).sort()).toEqual([ids.supplierA, ids.supplierB].sort());
    expect(await daftar({ supplierIds: [] })).toEqual({ baris: [], ringkasan: [] });
    expect(await hitungPenerimaanBelumDiminta(ASOF, [])).toBe(0);
  });

  it("a live bill line covering the receipt drops it; voiding the bill lists it again", async () => {
    const bill = await createVendorBill(
      {
        supplierId: ids.supplierA,
        vendorInvoiceNo: `INV-${tag}`,
        billDate: new Date("2026-10-02"),
        lines: [{ type: "GRN_ITEM", grnId: ids.grnA, itemId: ids.item, variantSku: null, qty: 100, price: 8_000 }],
      },
      ids.user,
    );
    // Harga invoice sama dengan harga penerimaan: tidak ada selisih yang menunggu.
    expect(bill.koreksi).toBe(0);
    expect((await daftar({ supplierId: ids.supplierA })).baris).toEqual([]);
    expect(await hitungPenerimaanBelumDiminta(ASOF, [ids.supplierA])).toBe(0);

    await voidVendorBill(bill.id, "invoice salah", ids.user);
    expect((await daftar({ supplierId: ids.supplierA })).baris.map((b) => [b.id, b.ditagih, b.belum])).toEqual([[ids.grnA, 0, 100]]);
    expect(await hitungPenerimaanBelumDiminta(ASOF, [ids.supplierA])).toBe(1);
  });

  it("a completed vendor return lowers what is still to bill by the returned qty", async () => {
    await prisma.vendorReturn.create({
      data: {
        docNumber: `RET-${tag}`,
        vendorId: ids.supplierB,
        grnId: ids.grnB,
        lines: [{ itemId: ids.item, variantSku: null, qty: 30 }],
        totalItems: 1,
        totalValue: 240_000,
        status: "COMPLETED",
        completedAt: new Date(),
        createdById: ids.user,
      },
    });
    expect((await daftar({ supplierId: ids.supplierB })).baris.map((b) => [b.id, b.diterima, b.diretur, b.belum])).toEqual([[ids.grnB, 100, 30, 70]]);
  });

  it("a no-PO receipt awaiting admin confirmation is listed as blocked and not counted on the Beranda; once confirmed it is", async () => {
    const tanpaPo = await penerimaan(ids.supplierA, "A2", { tanpaPo: true, menungguKonfirmasi: true, qty: 50 });
    const r = await daftar({ supplierId: ids.supplierA });
    expect(r.baris.map((b) => [b.id, b.terhalang, b.belum]).sort()).toEqual(
      [
        [ids.grnA, null, 100],
        [tanpaPo, "MENUNGGU_KONFIRMASI", 50],
      ].sort(),
    );
    expect(await hitungPenerimaanBelumDiminta(ASOF, [ids.supplierA])).toBe(1);

    await prisma.gRN.update({ where: { id: seededId(tanpaPo) }, data: { noPoConfirmedAt: new Date(), noPoConfirmedById: ids.user } });
    expect(await hitungPenerimaanBelumDiminta(ASOF, [ids.supplierA])).toBe(2);
  });

  it("an open invoice request turns the receipt DIMINTA, and status 'belum' hides it", async () => {
    const m = await mintaInvoice({ supplierId: ids.supplierA, sumber: [{ jenis: "GRN", id: ids.grnA }], saluran: "WHATSAPP", olehUserId: ids.user });
    if (!m.ok) throw new Error(`minta gagal: ${m.kode}`);
    await prisma.supplierInvoiceRequest.update({ where: { id: seededId(m.id) }, data: { requestedAt: DIMINTA, lastRequestedAt: DIMINTA } });

    expect((await daftar({ supplierId: ids.supplierA })).baris.map((b) => [b.id, b.status, b.diminta?.requestId, b.diminta?.tanggal])).toEqual([
      [ids.grnA, "DIMINTA", m.id, "2026-10-01"],
    ]);
    expect((await daftar({ supplierId: ids.supplierA, status: "belum" })).baris).toEqual([]);
    expect((await daftar({ supplierId: ids.supplierA, status: "diminta" })).baris.map((b) => b.id)).toEqual([ids.grnA]);
    expect((await daftar({ supplierId: ids.supplierA, status: "terlambat" })).baris).toEqual([]);
    expect(await hitungPenerimaanBelumDiminta(ASOF, [ids.supplierA])).toBe(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaHppTerbaru, bacaRiwayatHpp } from "./riwayat-hpp-queries";

/*
 * Riwayat HPP barang terhadap basis data uji: angka dibaca dari penerimaan
 * barang jadi, entri buku stok, dan GRN yang TERSIMPAN — tidak pernah dari
 * rata-rata stok sekarang. Semua tanggal 2003–2004; barang, WO, GRN, dan entri
 * buku stok milik tes sendiri.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("bacaRiwayatHpp (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let itemId = "";
  let lainId = "";
  let belanjaId = "";
  let woId = "";
  let woLainId = "";
  let grnId = "";
  let grnBesarId = "";
  let grnLamaId = "";
  let r1 = "";
  let r2 = "";
  let r3 = "";

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    itemId = "";
    lainId = "";
    belanjaId = "";
    woId = "";
    woLainId = "";
    grnId = "";
    grnBesarId = "";
    grnLamaId = "";
    r1 = "";
    r2 = "";
    r3 = "";
    userId = (await prisma.user.create({ data: { email: `rhp-${token}@uji.local`, name: "Uji riwayat HPP" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TRH-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-RH-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `R${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    const skuM = `FG-RH-${token}-M`;
    itemId = (
      await prisma.item.create({
        data: {
          sku: `FG-RH-${token}`,
          nameId: "Kaos uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          variants: [{ Warna: "Hitam", Ukuran: "M", sku: skuM }],
        },
        select: { id: true },
      })
    ).id;
    lainId = (
      await prisma.item.create({
        data: { sku: `FG-RHL-${token}`, nameId: "Lain", nameEn: "Other", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    // Barang beli dengan GRN banyak varian: GRN tidak boleh terbelah antarhalaman.
    belanjaId = (
      await prisma.item.create({
        data: { sku: `FG-RHB-${token}`, nameId: "Beli", nameEn: "Bought", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    const wo = (docNumber: string, finishedGoodId: string) =>
      prisma.workOrder.create({
        data: { docNumber, vendorId, finishedGoodId, plannedQty: 100, consumptionPlan: {}, createdById: userId },
        select: { id: true },
      });
    woId = (await wo(`WO-RH-${token}`, itemId)).id;
    woLainId = (await wo(`WO-RHL-${token}`, lainId)).id;

    const terima = (urut: number, isi: { wo?: string; qty: number; perPcs: number; bahan: number; hari: string }) =>
      prisma.fGReceipt.create({
        data: {
          docNumber: `RCPT-RH-${token}-${urut}`,
          woId: isi.wo ?? woId,
          receiptType: "GENERIC",
          qtyReceived: Math.max(isi.qty, 1),
          qtyRejected: isi.qty > 0 ? 0 : 1,
          qtyAccepted: isi.qty,
          materialCost: isi.bahan,
          serviceCost: 0,
          additionalCost: 0,
          avgCostPerUnit: isi.perPcs,
          totalCostValue: isi.perPcs * isi.qty,
          receivedById: userId,
          receivedAt: new Date(`${isi.hari}T03:00:00.000Z`),
        },
        select: { id: true },
      });
    // r1: penerimaan dari sebelum buku stok (tanpa entri). r2: dengan entri per varian.
    r1 = (await terima(1, { qty: 10, perPcs: 50_000, bahan: 300_000, hari: "2003-05-01" })).id;
    r2 = (await terima(2, { qty: 30, perPcs: 55_000, bahan: 900_000, hari: "2004-02-01" })).id;
    // Semua cacat: tidak tampil.
    await terima(3, { qty: 0, perPcs: 0, bahan: 0, hari: "2004-02-15" });
    // Barang lain, lebih baru: tidak boleh bocor.
    r3 = (await terima(4, { wo: woLainId, qty: 2, perPcs: 1_000, bahan: 2_000, hari: "2004-12-01" })).id;

    const buku = (isi: {
      item?: string;
      lokasi?: "MAIN" | "STORE";
      jenis?: "IN" | "OUT";
      refType: string;
      refId: string;
      varian?: string;
      qty: number;
      nilai: number | null;
      saldoQty: number;
      saldoNilai: number | null;
      hari: string;
      jam?: string;
    }) =>
      prisma.stockLedgerEntry.create({
        data: {
          locationType: isi.lokasi ?? "MAIN",
          locationId: isi.lokasi === "STORE" ? "toko-uji" : "",
          itemId: isi.item ?? itemId,
          variantSku: isi.varian ?? "",
          type: isi.jenis ?? "IN",
          qty: isi.qty,
          totalCost: isi.nilai,
          balanceQty: isi.saldoQty,
          balanceValue: isi.saldoNilai,
          refType: isi.refType,
          refId: isi.refId,
          refDocNumber: `REF-${token}`,
          createdAt: new Date(`${isi.hari}T${isi.jam ?? "03:00:00.000"}Z`),
        },
      });
    await buku({ refType: "FGReceipt", refId: r2, varian: skuM, qty: 30, nilai: 1_650_000, saldoQty: 40, saldoNilai: 2_150_000, hari: "2004-02-01" });
    await buku({ item: lainId, refType: "FGReceipt", refId: r3, qty: 2, nilai: 2_000, saldoQty: 2, saldoNilai: 2_000, hari: "2004-12-01" });

    grnId = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-RH-${token}`,
          supplierId: vendorId,
          receivedBy: userId,
          totalAmount: 600_000,
          items: [],
          grnDate: new Date("2004-03-01T03:00:00.000Z"),
        },
        select: { id: true },
      })
    ).id;
    await buku({ refType: "GRN", refId: grnId, qty: 10, nilai: 600_000, saldoQty: 50, saldoNilai: 2_750_000, hari: "2004-03-01" });
    // Bukan peristiwa biaya gudang utama: keluar, dan masuk di toko.
    await buku({ jenis: "OUT", refType: "GRN", refId: grnId, qty: -1, nilai: -55_000, saldoQty: 49, saldoNilai: 2_695_000, hari: "2004-03-02" });
    await buku({ lokasi: "STORE", refType: "GRN", refId: grnId, qty: 5, nilai: 1, saldoQty: 5, saldoNilai: 1, hari: "2004-03-03" });

    const grnUji = async (akhiran: string, hari: string) =>
      (
        await prisma.gRN.create({
          data: {
            docNumber: `GRN-RHB-${token}-${akhiran}`,
            supplierId: vendorId,
            receivedBy: userId,
            totalAmount: 0,
            items: [],
            grnDate: new Date(`${hari}T03:00:00.000Z`),
          },
          select: { id: true },
        })
      ).id;
    grnLamaId = await grnUji("lama", "2003-06-01");
    grnBesarId = await grnUji("besar", "2003-07-01");
    await buku({ item: belanjaId, refType: "GRN", refId: grnLamaId, qty: 4, nilai: 40_000, saldoQty: 4, saldoNilai: 40_000, hari: "2003-06-01" });
    // Dua varian satu GRN, entrinya berselisih beberapa milidetik.
    await buku({ item: belanjaId, refType: "GRN", refId: grnBesarId, varian: "B-S", qty: 2, nilai: 24_000, saldoQty: 2, saldoNilai: 24_000, hari: "2003-07-01" });
    await buku({ item: belanjaId, refType: "GRN", refId: grnBesarId, varian: "B-M", qty: 3, nilai: 39_000, saldoQty: 3, saldoNilai: 39_000, hari: "2003-07-01", jam: "03:00:00.005" });
  });

  afterAll(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: seededIds([itemId, lainId, belanjaId]) } } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds([grnId, grnBesarId, grnLamaId]) } } });
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds([woId, woLainId]) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds([woId, woLainId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId, lainId, belanjaId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("penerimaan dan pembelian barang ini saja, terbaru dulu, dengan HPP peristiwa itu sendiri", async () => {
    const r = await bacaRiwayatHpp(prisma, itemId, { batas: 50 });
    expect(r).toMatchObject({ adaLagi: false, berikutnya: null });
    expect(
      r.baris.map((b) => ({
        jenis: b.jenis,
        dokumen: b.dokumen,
        varian: b.varianLabel ?? b.varianSku,
        jumlah: b.jumlah,
        hpp: b.hppPerPcs,
        sesudah: b.rataRataSesudah,
      })),
    ).toEqual([
      { jenis: "PEMBELIAN", dokumen: `GRN-RH-${token}`, varian: null, jumlah: 10, hpp: 60_000, sesudah: 55_000 },
      { jenis: "PRODUKSI", dokumen: `RCPT-RH-${token}-2`, varian: `Hitam · M (FG-RH-${token}-M)`, jumlah: 30, hpp: 55_000, sesudah: 53_750 },
      { jenis: "PRODUKSI", dokumen: `RCPT-RH-${token}-1`, varian: null, jumlah: 10, hpp: 50_000, sesudah: null },
    ]);
    expect(r.baris[0].tautan).toBe(`/backoffice/inventory/grn/${grnId}`);
    expect(r.baris[1].tautan).toBe(`/backoffice/work-orders/${woId}?tab=receipts`);
  });

  it("batas memotong daftar gabungan; penunjuk membuka sisanya tanpa mengulang", async () => {
    const r = await bacaRiwayatHpp(prisma, itemId, { batas: 2 });
    expect(r.baris.map((b) => b.dokumen)).toEqual([`GRN-RH-${token}`, `RCPT-RH-${token}-2`]);
    expect(r).toMatchObject({ adaLagi: true, berikutnya: "2004-02-01T03:00:00.000Z" });
    const lanjut = await bacaRiwayatHpp(prisma, itemId, { batas: 2, sebelum: r.berikutnya });
    expect(lanjut.baris.map((b) => b.dokumen)).toEqual([`RCPT-RH-${token}-1`]);
    expect(lanjut).toMatchObject({ adaLagi: false, berikutnya: null });
  });

  it("satu baris per halaman tetap berjalan sampai habis (tidak ada batas atas yang membuat 'Muat lagi' macet)", async () => {
    const dokumen: string[] = [];
    let sebelum: string | null = null;
    for (let i = 0; i < 10; i++) {
      const h = await bacaRiwayatHpp(prisma, itemId, { batas: 1, sebelum });
      dokumen.push(...h.baris.map((b) => b.dokumen));
      if (!h.adaLagi) break;
      sebelum = h.berikutnya;
    }
    expect(dokumen).toEqual([`GRN-RH-${token}`, `RCPT-RH-${token}-2`, `RCPT-RH-${token}-1`]);
  });

  it("GRN banyak varian tidak terbelah dan tidak terbaca ulang di halaman berikutnya", async () => {
    const r = await bacaRiwayatHpp(prisma, belanjaId, { batas: 1 });
    expect(r.baris.map((b) => [b.dokumen, b.varianSku, b.jumlah, b.hppPerPcs, b.hppDokumen, b.tanggal])).toEqual([
      [`GRN-RHB-${token}-besar`, "B-M", 3, 13_000, 12_600, "2003-07-01T03:00:00.005Z"],
      [`GRN-RHB-${token}-besar`, "B-S", 2, 12_000, 12_600, "2003-07-01T03:00:00.005Z"],
    ]);
    expect(r).toMatchObject({ adaLagi: true, berikutnya: "2003-07-01T03:00:00.005Z" });
    // Entri B-S (03:00:00.000) lebih tua dari penunjuk, tetapi GRN-nya sudah tampil: tidak terbaca ulang.
    const lanjut = await bacaRiwayatHpp(prisma, belanjaId, { batas: 1, sebelum: r.berikutnya });
    expect(lanjut.baris.map((b) => b.dokumen)).toEqual([`GRN-RHB-${token}-lama`]);
    expect(lanjut).toMatchObject({ adaLagi: false, berikutnya: null });
  });

  it("HPP terbaru = peristiwa terbaru (GRN 60.000), bukan rata-rata stok", async () => {
    expect(await bacaHppTerbaru(prisma, itemId)).toMatchObject({
      perPcs: 60_000,
      jenis: "PEMBELIAN",
      dokumen: `GRN-RH-${token}`,
      tanggal: "2004-03-01T03:00:00.000Z",
      jumlah: 10,
    });
  });

  it("HPP terbaru dicari di halaman berikutnya kalau halaman pertama tidak memuatnya", async () => {
    const pertama = await bacaRiwayatHpp(prisma, itemId, { batas: 1 });
    // Halaman pertama dibuat seolah GRN-nya ditolak: HPP terbaru = peristiwa berikutnya, penerimaan 55.000.
    const ditolak = { ...pertama, baris: pertama.baris.map((b) => ({ ...b, catatan: "DITOLAK_PEMILIK" as const })) };
    expect(await bacaHppTerbaru(prisma, itemId, ditolak)).toMatchObject({
      perPcs: 55_000,
      dokumen: `RCPT-RH-${token}-2`,
    });
  });

  it("barang tanpa peristiwa biaya → kosong", async () => {
    const r = await bacaRiwayatHpp(prisma, `tidak-ada-${token}`, { batas: 50 });
    expect(r).toEqual({ baris: [], adaLagi: false, berikutnya: null });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { bedaDiJubelio, hargaKeTeks, jenisMenunggu, keadaanHargaJubelio } from "./aturan";
import {
  bacaHargaJubelioBarang,
  daftarHargaBedaDiJubelio,
  daftarHargaMenunggu,
  hitungBarangJubelioTanpaHarga,
  hitungHargaBedaDiJubelio,
  hitungHargaMenungguKonfirmasi,
  idKirimanTertahanSiapDilepas,
} from "./queries";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Daftar konfirmasi harga Jubelio dan hitungan Beranda memakai satu fragmen SQL, kembaran
 * `keadaanHargaJubelio`. Kesalahan kueri lolos dari tes murni, jadi kuerinya diuji terhadap basis
 * data sungguhan — setiap pemanggilan dibatasi ke barang yang disemai tes ini (`hanyaBarang`).
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kueri konfirmasi harga Jubelio (test bed only)", () => {
  const fx = buatFixtureHarga();

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await fx.bersihkan();
  });

  async function semai() {
    const sama = await fx.barang({ terpetakan: true, sellingPrice: 100_000, jubelioConfirmedPrice: 100_000 });
    const ubah = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
    const baru = await fx.barang({ jubelioCreateRequestedAt: new Date(), jubelioCreateRequestedById: fx.keadaan.userId });
    const belumDiajukan = await fx.barang({});
    const ingest = await fx.barang({ source: "JUBELIO_INGEST", jubelioCreateRequestedAt: new Date() });
    const kain = await fx.barang({ type: "FABRIC", terpetakan: true, sellingPrice: 5_000, jubelioConfirmedPrice: 4_000 });
    const nolDuaSisi = await fx.barang({ terpetakan: true, sellingPrice: 0, jubelioConfirmedPrice: null });
    const kosongErp = await fx.barang({ terpetakan: true, sellingPrice: null, jubelioConfirmedPrice: 90_000 });
    const tanpaPeta = await fx.barang({ kategori: "tidak", jubelioCreateRequestedAt: new Date() });
    return { sama, ubah, baru, belumDiajukan, ingest, kain, nolDuaSisi, kosongErp, tanpaPeta };
  }

  it("hanya barang di Jubelio yang harganya berbeda dan produk baru yang diajukan yang menunggu; hitungan = jumlah baris", async () => {
    const s = await semai();
    const hanyaBarang = Object.values(s);
    const { baris, total, terpotong } = await daftarHargaMenunggu({ hanyaBarang });

    expect(new Map(baris.map((b) => [b.itemId, b.jenis]))).toEqual(
      new Map([
        [s.ubah, "UBAH"],
        [s.baru, "BARU"],
        [s.kosongErp, "UBAH"],
        [s.tanpaPeta, "BARU"],
      ]),
    );
    expect(total).toBe(4);
    expect(terpotong).toBe(false);
    expect(await hitungHargaMenungguKonfirmasi({ hanyaBarang })).toBe(baris.length);
  });

  it("aturan SQL dan keadaanHargaJubelio sepakat untuk setiap barang yang disemai", async () => {
    const s = await semai();
    const hanyaBarang = Object.values(s);
    const menunggu = new Map((await daftarHargaMenunggu({ hanyaBarang })).baris.map((b) => [b.itemId, b.jenis]));
    const barang = await prisma.item.findMany({
      where: { id: { in: hanyaBarang.map(seededId) } },
      select: { id: true, type: true, source: true, salesChannel: true, sellingPrice: true, jubelioConfirmedPrice: true, jubelioCreateRequestedAt: true, _count: { select: { jubelioProductMappings: true } } },
    });
    for (const b of barang) {
      const jenis = jenisMenunggu(
        keadaanHargaJubelio({
          barangJadi: b.type === "FINISHED_GOOD",
          sumber: b.source,
          saluran: b.salesChannel,
          terpetakan: b._count.jubelioProductMappings > 0,
          hargaErp: hargaKeTeks(b.sellingPrice),
          hargaJubelio: hargaKeTeks(b.jubelioConfirmedPrice),
          diajukanPada: b.jubelioCreateRequestedAt,
        }),
      );
      expect(menunggu.get(b.id) ?? null, b.id).toBe(jenis);
    }
  });

  it("baris membawa harga Jubelio, harga ERP, pengubah terbaru, dan alasan bila tidak bisa dikirim", async () => {
    const s = await semai();
    await prisma.itemPriceChangeLog.create({
      data: { itemId: s.ubah, oldSellingPrice: 100_000, newSellingPrice: 120_000, triggerReason: "MANUAL_EDIT", changedById: fx.keadaan.userLainId },
    });
    const { baris } = await daftarHargaMenunggu({ hanyaBarang: Object.values(s) });
    const per = new Map(baris.map((b) => [b.itemId, b]));

    expect(per.get(s.ubah)).toMatchObject({
      hargaJubelio: "100000.00",
      hargaErp: "120000.00",
      diubahOleh: "Pengubah harga uji",
      alasan: null,
      kategoriTerpetakan: true,
    });
    expect(per.get(s.ubah)?.diubahPada).toEqual(expect.any(String));
    expect(per.get(s.baru)).toMatchObject({ hargaJubelio: null, hargaErp: "100000.00", diubahOleh: "Admin uji harga", alasan: null });
    expect(per.get(s.baru)?.diajukanPada).toEqual(per.get(s.baru)?.diubahPada);
    expect(per.get(s.kosongErp)).toMatchObject({ hargaJubelio: "90000.00", hargaErp: null, alasan: "HARGA_KOSONG" });
    expect(per.get(s.tanpaPeta)).toMatchObject({ alasan: "KATEGORI_BELUM_DIPETAKAN", kategoriTerpetakan: false });
  });

  it("harga yang dikembalikan ke harga terkonfirmasi keluar dari daftar dengan sendirinya", async () => {
    const s = await semai();
    await prisma.item.update({ where: { id: seededId(s.ubah) }, data: { sellingPrice: 100_000 } });
    const { baris } = await daftarHargaMenunggu({ hanyaBarang: [s.ubah] });
    expect(baris).toEqual([]);
    expect(await hitungHargaMenungguKonfirmasi({ hanyaBarang: [s.ubah] })).toBe(0);
  });

  it("menyaring menurut jenis dan pencarian SKU/nama", async () => {
    const s = await semai();
    const hanyaBarang = Object.values(s);
    expect((await daftarHargaMenunggu({ hanyaBarang, jenis: "BARU" })).baris.map((b) => b.itemId).sort()).toEqual([s.baru, s.tanpaPeta].sort());
    expect((await daftarHargaMenunggu({ hanyaBarang, jenis: "UBAH" })).baris.map((b) => b.itemId).sort()).toEqual([s.ubah, s.kosongErp].sort());
    const sku = (await prisma.item.findUniqueOrThrow({ where: { id: seededId(s.ubah) }, select: { sku: true } })).sku;
    const hasil = await daftarHargaMenunggu({ hanyaBarang, cari: sku.toLowerCase() });
    expect(hasil.baris.map((b) => b.itemId)).toEqual([s.ubah]);
    expect(hasil.total).toBe(1);
  });

  it("barang di Jubelio tanpa harga di kedua sisi dihitung terpisah, tidak masuk daftar", async () => {
    const s = await semai();
    expect(await hitungBarangJubelioTanpaHarga({ hanyaBarang: Object.values(s) })).toBe(1);
    expect(await hitungBarangJubelioTanpaHarga({ hanyaBarang: [] })).toBe(0);
    expect(await hitungHargaMenungguKonfirmasi({ hanyaBarang: [] })).toBe(0);
  });

  it("kartu barang membaca keadaan dan kiriman terakhirnya", async () => {
    const s = await semai();
    await prisma.jubelioOutbox.create({
      data: { entityType: "product_push", entityId: s.ubah, payload: {}, status: "SKIPPED", skipReason: "category_unmapped" },
    });
    const kartu = await bacaHargaJubelioBarang(s.ubah);
    expect(kartu).toMatchObject({
      keadaan: "MENUNGGU_UBAH",
      hargaJubelio: "100000.00",
      hargaErp: "120000.00",
      kirimanTerakhir: { status: "SKIPPED", skipReason: "category_unmapped" },
    });
    expect((await bacaHargaJubelioBarang(s.sama))?.keadaan).toBe("SAMA");
    expect((await bacaHargaJubelioBarang(s.nolDuaSisi))?.keadaan).toBe("TANPA_HARGA");
    expect((await bacaHargaJubelioBarang(s.belumDiajukan))?.keadaan).toBe("BELUM_DI_JUBELIO");
    expect(await bacaHargaJubelioBarang("tidak-ada")).toBeNull();
  });
  /*
   * Jawaban pemilik 2026-11-02: "Toko offline saja" tidak pernah menunggu (P3a), dan "Harga di
   * Jubelio berbeda dengan ERP" (P2/P75) — fragmen SQL `sumberBeda` dan `bedaDiJubelio` sepakat.
   */
  it("Toko offline saja tidak pernah menunggu dan tidak dihitung tanpa harga", async () => {
    const ubah = await fx.barang({ salesChannel: "OFFLINE", terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
    const baru = await fx.barang({ salesChannel: "OFFLINE", jubelioCreateRequestedAt: new Date() });
    const kosong = await fx.barang({ salesChannel: "OFFLINE", terpetakan: true, sellingPrice: null, jubelioConfirmedPrice: null });
    const hanyaBarang = [ubah, baru, kosong];
    expect((await daftarHargaMenunggu({ hanyaBarang })).baris).toEqual([]);
    expect(await hitungHargaMenungguKonfirmasi({ hanyaBarang })).toBe(0);
    expect(await hitungBarangJubelioTanpaHarga({ hanyaBarang })).toBe(0);
    expect((await bacaHargaJubelioBarang(ubah))?.keadaan).toBe("SALURAN_OFFLINE");
  });

  it("BEDA: daftar SQL = bedaDiJubelio atas seluruh semaian; hitungan = jumlah baris", async () => {
    const tadi = new Date("2026-11-03T01:00:00.000Z");
    const sebelum = new Date("2026-11-03T00:30:00.000Z");
    const sesudah = new Date("2026-11-03T01:30:00.000Z");
    const dasar = { terpetakan: true, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 125_000, jubelioTerendah: 125_000 };
    const ids = {
      beda: await fx.barang(dasar),
      sama: await fx.barang({ ...dasar, jubelioTertinggi: 100_000, jubelioTerendah: 100_000 }),
      terendahNol: await fx.barang({ ...dasar, jubelioTertinggi: 100_000, jubelioTerendah: 0 }),
      belumTerbaca: await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000 }),
      belumDiJubelio: await fx.barang({ ...dasar, terpetakan: false }),
      putusBerlakuDikirim: await fx.barang({ ...dasar, diputuskanPada: sesudah }),
      putusBerlakuTanpaKiriman: await fx.barang({ ...dasar, diputuskanPada: sesudah }),
      putusBasiDikirim: await fx.barang({ ...dasar, diputuskanPada: sebelum }),
      offlineDitahan: await fx.barang({ ...dasar, salesChannel: "OFFLINE" }),
      offlineSudahNonaktif: await fx.barang({ ...dasar, salesChannel: "OFFLINE" }),
      kain: await fx.barang({ ...dasar, type: "FABRIC" }),
    };
    await fx.kiriman(ids.putusBerlakuDikirim, { status: "PENDING" });
    await fx.kiriman(ids.putusBasiDikirim, { status: "PROCESSING" });
    await fx.kiriman(ids.offlineDitahan, { status: "SKIPPED", skipReason: "price_differs_held" });
    await fx.kiriman(ids.offlineSudahNonaktif, { status: "DONE" });
    const hanyaBarang = Object.values(ids);

    const { baris, total } = await daftarHargaBedaDiJubelio({ hanyaBarang });
    const diSql = new Set(baris.map((b) => b.itemId));
    expect(await hitungHargaBedaDiJubelio({ hanyaBarang })).toBe(total);

    const barang = await prisma.item.findMany({
      where: { id: { in: hanyaBarang.map(seededId) } },
      select: {
        id: true,
        type: true,
        jubelioConfirmedPrice: true,
        jubelioObservedPriceMax: true,
        jubelioObservedPriceMin: true,
        jubelioObservedAt: true,
        jubelioObservedChangedAt: true,
        jubelioPriceDecidedAt: true,
        _count: { select: { jubelioProductMappings: true } },
      },
    });
    for (const b of barang) {
      const kiriman = await prisma.jubelioOutbox.findMany({
        where: { entityId: seededId(b.id), entityType: "product_push" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { status: true },
      });
      const murni = bedaDiJubelio({
        barangJadi: b.type === "FINISHED_GOOD",
        terpetakan: b._count.jubelioProductMappings > 0,
        terbacaPada: b.jubelioObservedAt,
        jubelioTertinggi: hargaKeTeks(b.jubelioObservedPriceMax),
        jubelioTerendah: hargaKeTeks(b.jubelioObservedPriceMin),
        hargaTerkonfirmasi: hargaKeTeks(b.jubelioConfirmedPrice),
        diputuskanPada: b.jubelioPriceDecidedAt,
        berubahPada: b.jubelioObservedChangedAt,
        sedangDikirim: kiriman.some((k) => k.status === "PENDING" || k.status === "PROCESSING"),
      });
      expect(diSql.has(b.id), b.id).toBe(murni);
    }
    /* R22: "Toko offline saja" tetap BEDA apa pun keadaan kiriman terakhirnya (ditahan atau sudah DONE). */
    expect([...diSql].sort()).toEqual(
      [
        ids.beda,
        ids.terendahNol,
        ids.putusBerlakuTanpaKiriman,
        ids.putusBasiDikirim,
        ids.offlineDitahan,
        ids.offlineSudahNonaktif,
      ].sort(),
    );
    expect(baris.find((b) => b.itemId === ids.offlineDitahan)).toMatchObject({ saluran: "OFFLINE", kirimanDitahan: true });
    expect(baris.find((b) => b.itemId === ids.offlineSudahNonaktif)).toMatchObject({ saluran: "OFFLINE", kirimanDitahan: false });
  });

  it("baris UBAH yang juga BEDA membawa bacaan Jubelio; kiriman tertahan siap dilepas hanya bila tidak beda", async () => {
    const tadi = new Date("2026-11-03T01:00:00.000Z");
    const ubah = await fx.barang({
      terpetakan: true,
      sellingPrice: 120_000,
      jubelioConfirmedPrice: 100_000,
      terbacaPada: tadi,
      jubelioTertinggi: 110_000,
      jubelioTerendah: 110_000,
    });
    const per = new Map((await daftarHargaMenunggu({ hanyaBarang: [ubah] })).baris.map((b) => [b.itemId, b]));
    expect(per.get(ubah)).toMatchObject({ jenis: "UBAH", bedaDiJubelio: true, jubelioTertinggi: "110000.00", jubelioTerendah: "110000.00" });

    const lepas = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 100_000, jubelioTerendah: 100_000 });
    const tahan = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 125_000, jubelioTerendah: 125_000 });
    // Ditahan, tidak beda, tetapi produknya sudah dihapus dari Jubelio: melepasnya akan membuat produk baru.
    const tanpaPeta = await fx.barang({ terpetakan: false, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 100_000, jubelioTerendah: 100_000 });
    for (const id of [lepas, tahan, tanpaPeta]) await fx.kiriman(id, { status: "SKIPPED", skipReason: "price_differs_held" });
    expect(await idKirimanTertahanSiapDilepas({ hanyaBarang: [lepas, tahan, tanpaPeta] })).toEqual([lepas]);
  });
});

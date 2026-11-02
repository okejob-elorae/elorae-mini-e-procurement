import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { hargaKeTeks, jenisMenunggu, keadaanHargaJubelio } from "./aturan";
import { bacaHargaJubelioBarang, daftarHargaMenunggu, hitungBarangJubelioTanpaHarga, hitungHargaMenungguKonfirmasi } from "./queries";
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
      select: { id: true, type: true, source: true, sellingPrice: true, jubelioConfirmedPrice: true, jubelioCreateRequestedAt: true, _count: { select: { jubelioProductMappings: true } } },
    });
    for (const b of barang) {
      const jenis = jenisMenunggu(
        keadaanHargaJubelio({
          barangJadi: b.type === "FINISHED_GOOD",
          sumber: b.source,
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
});

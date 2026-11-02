import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { updateItem as updateItemLib } from "@/lib/items/mutations";
import { JEJAK_HARGA_JUBELIO } from "./aturan";
import { batalkanPengajuanJubelio, kembalikanHargaErp, konfirmasiHargaJubelio } from "./writer";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Keputusan di halaman Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02). Setiap
 * keputusan adalah compare-and-swap di dalam runSerializable, dengan jejak audit dan kiriman
 * produknya di transaksi yang sama — diuji terhadap basis data sungguhan, termasuk balapan.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("penulis konfirmasi harga Jubelio (test bed only)", () => {
  const fx = buatFixtureHarga();

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await fx.bersihkan();
  });

  const jejak = (itemId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId: seededId(itemId), action }, select: { userId: true, changes: true } });
  const kiriman = (itemId: string) =>
    prisma.jubelioOutbox.count({ where: { entityId: seededId(itemId), entityType: "product_push" } });

  describe("konfirmasiHargaJubelio", () => {
    it("perubahan harga: harga terkonfirmasi = harga ERP, satu jejak, satu kiriman, bersama", async () => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      const hasil = await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId });

      expect(hasil).toMatchObject({ hasil: "DIKONFIRMASI", jenis: "UBAH", outboxId: expect.any(String) });
      expect(await fx.baca(id)).toMatchObject({ harga: 120_000, dikonfirmasi: 120_000, dikonfirmasiOleh: fx.keadaan.userId, diajukanPada: null });
      const audit = await jejak(id, JEJAK_HARGA_JUBELIO.DIKONFIRMASI);
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(fx.keadaan.userId);
      expect(audit[0].changes).toMatchObject({
        jenis: "UBAH",
        before: { jubelioConfirmedPrice: "100000.00" },
        after: { jubelioConfirmedPrice: "120000.00" },
      });
      expect(await kiriman(id)).toBe(1);
      const row = await prisma.jubelioOutbox.findFirstOrThrow({ where: { entityId: seededId(id) }, select: { id: true, enqueuedById: true, status: true } });
      expect(hasil.hasil === "DIKONFIRMASI" && hasil.outboxId).toBe(row.id);
      expect(row).toMatchObject({ enqueuedById: fx.keadaan.userId, status: "PENDING" });
    });

    it("harga ERP berubah sejak halaman dibuka → HARGA_BERUBAH, tidak ada yang ditulis", async () => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 130_000, jubelioConfirmedPrice: 100_000 });
      const hasil = await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId });

      expect(hasil).toEqual({ hasil: "HARGA_BERUBAH" });
      expect((await fx.baca(id)).dikonfirmasi).toBe(100_000);
      expect(await jejak(id, JEJAK_HARGA_JUBELIO.DIKONFIRMASI)).toHaveLength(0);
      expect(await kiriman(id)).toBe(0);
    });

    it("produk baru: pengajuan ditutup, harga terkonfirmasi, kiriman pembuatnya diantrekan", async () => {
      const id = await fx.barang({ sellingPrice: 150_000, jubelioCreateRequestedAt: new Date(), jubelioCreateRequestedById: fx.keadaan.userLainId });
      const hasil = await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "150000.00", olehUserId: fx.keadaan.userId });

      expect(hasil).toMatchObject({ hasil: "DIKONFIRMASI", jenis: "BARU" });
      expect(await fx.baca(id)).toMatchObject({ dikonfirmasi: 150_000, diajukanPada: null, diajukanOleh: null });
      expect(await kiriman(id)).toBe(1);
      const audit = await jejak(id, JEJAK_HARGA_JUBELIO.DIKONFIRMASI);
      expect(audit[0].changes).toMatchObject({ jenis: "BARU", before: { jubelioCreateRequestedById: fx.keadaan.userLainId } });
    });

    it("produk baru yang kategorinya belum dipetakan → KATEGORI_BELUM_DIPETAKAN (berlaku juga untuk perubahan harga)", async () => {
      const baru = await fx.barang({ kategori: "tidak", jubelioCreateRequestedAt: new Date() });
      expect(await konfirmasiHargaJubelio({ itemId: baru, hargaErpDiharapkan: "100000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "KATEGORI_BELUM_DIPETAKAN",
      });
      const ubah = await fx.barang({ kategori: "kosong", terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      expect(await konfirmasiHargaJubelio({ itemId: ubah, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "KATEGORI_BELUM_DIPETAKAN",
      });
      expect(await kiriman(baru)).toBe(0);
      expect(await kiriman(ubah)).toBe(0);
    });

    it.each([
      ["kosong", null, null],
      ["0", 0, "0.00"],
    ])("harga ERP %s → HARGA_KOSONG", async (_label, harga, token) => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: harga, jubelioConfirmedPrice: 100_000 });
      expect(await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: token, olehUserId: fx.keadaan.userId })).toEqual({ hasil: "HARGA_KOSONG" });
      expect((await fx.baca(id)).dikonfirmasi).toBe(100_000);
      expect(await kiriman(id)).toBe(0);
    });

    it("baris yang sudah tidak menunggu → TIDAK_MENUNGGU", async () => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 100_000, jubelioConfirmedPrice: 100_000 });
      expect(await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "100000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "TIDAK_MENUNGGU",
      });
      const kain = await fx.barang({ type: "FABRIC", terpetakan: true, sellingPrice: 5_000, jubelioConfirmedPrice: 4_000 });
      expect(await konfirmasiHargaJubelio({ itemId: kain, hargaErpDiharapkan: "5000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "BUKAN_BARANG_JADI",
      });
      expect(await konfirmasiHargaJubelio({ itemId: "tidak-ada", hargaErpDiharapkan: null, olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "TIDAK_DITEMUKAN",
      });
    });
  });

  describe("kembalikanHargaErp", () => {
    it("harga ERP kembali ke harga Jubelio, tercatat MANUAL_EDIT, beraudit, dan dikirim ulang", async () => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      const hasil = await kembalikanHargaErp({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId });

      expect(hasil).toMatchObject({ hasil: "DIKEMBALIKAN", outboxId: expect.any(String) });
      expect(await fx.baca(id)).toMatchObject({ harga: 100_000, dikonfirmasi: 100_000 });
      const log = await prisma.itemPriceChangeLog.findMany({ where: { itemId: seededId(id) }, select: { triggerReason: true, oldSellingPrice: true, newSellingPrice: true, changedById: true } });
      expect(log.map((l) => ({ ...l, oldSellingPrice: Number(l.oldSellingPrice), newSellingPrice: Number(l.newSellingPrice) }))).toEqual([
        { triggerReason: "MANUAL_EDIT", oldSellingPrice: 120_000, newSellingPrice: 100_000, changedById: fx.keadaan.userId },
      ]);
      expect(await jejak(id, JEJAK_HARGA_JUBELIO.DIKEMBALIKAN)).toHaveLength(1);
      expect(await kiriman(id)).toBe(1);
    });

    it("menolak barang tanpa harga Jubelio, harga yang berubah, dan harga yang sudah sama", async () => {
      const tanpa = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: null });
      expect(await kembalikanHargaErp({ itemId: tanpa, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "TIDAK_BISA_DIKEMBALIKAN",
      });
      const berubah = await fx.barang({ terpetakan: true, sellingPrice: 130_000, jubelioConfirmedPrice: 100_000 });
      expect(await kembalikanHargaErp({ itemId: berubah, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "HARGA_BERUBAH",
      });
      const sama = await fx.barang({ terpetakan: true, sellingPrice: 100_000, jubelioConfirmedPrice: 100_000 });
      expect(await kembalikanHargaErp({ itemId: sama, hargaErpDiharapkan: "100000.00", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "SUDAH_SAMA",
      });
      for (const id of [tanpa, berubah, sama]) expect(await kiriman(id)).toBe(0);
    });
  });

  describe("batalkanPengajuanJubelio", () => {
    it("menutup pengajuan dengan jejak; token yang usang ditolak", async () => {
      const diajukan = new Date("2026-11-02T03:00:00.000Z");
      const id = await fx.barang({ jubelioCreateRequestedAt: diajukan, jubelioCreateRequestedById: fx.keadaan.userLainId });

      expect(await batalkanPengajuanJubelio({ itemId: id, diajukanPadaDiharapkan: "2026-11-01T03:00:00.000Z", olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "PENGAJUAN_BERUBAH",
      });
      expect((await fx.baca(id)).diajukanPada?.toISOString()).toBe(diajukan.toISOString());

      expect(await batalkanPengajuanJubelio({ itemId: id, diajukanPadaDiharapkan: diajukan.toISOString(), olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "DIBATALKAN",
      });
      expect(await fx.baca(id)).toMatchObject({ diajukanPada: null, diajukanOleh: null });
      const audit = await jejak(id, JEJAK_HARGA_JUBELIO.PENGAJUAN_DIBATALKAN);
      expect(audit).toHaveLength(1);
      expect(audit[0].changes).toMatchObject({ before: { jubelioCreateRequestedAt: diajukan.toISOString(), jubelioCreateRequestedById: fx.keadaan.userLainId } });

      expect(await batalkanPengajuanJubelio({ itemId: id, diajukanPadaDiharapkan: diajukan.toISOString(), olehUserId: fx.keadaan.userId })).toEqual({
        hasil: "SUDAH_TIDAK_DIAJUKAN",
      });
    });
  });

  /*
   * Balapan. Penjaga keadaan di sini adalah baca-lalu-tulis; hanya runSerializable yang membuat
   * basis datanya menolak salah satu (dan withRetry mengulangnya dengan bacaan baru). Penulis yang
   * lebih pendek dimulai beberapa milidetik lebih lambat di putaran kedua, supaya tes tidak lolos
   * karena satu penulis selalu sampai duluan.
   */
  describe("balapan", () => {
    it.each([0, 5])("dua konfirmasi baris yang sama (jeda %i ms): tepat satu DIKONFIRMASI, satu jejak, satu kiriman", async (ms) => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      const isi = { itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId };
      const hasil = await Promise.all([konfirmasiHargaJubelio(isi), jeda(ms).then(() => konfirmasiHargaJubelio(isi))]);

      expect(hasil.map((h) => h.hasil).sort()).toEqual(["DIKONFIRMASI", "TIDAK_MENUNGGU"]);
      expect(await jejak(id, JEJAK_HARGA_JUBELIO.DIKONFIRMASI)).toHaveLength(1);
      expect(await kiriman(id)).toBe(1);
    });

    it.each([0, 5])("konfirmasi lawan kembalikan (jeda %i ms): tepat satu berhasil", async (ms) => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      const [konfirmasi, kembalikan] = await Promise.all([
        konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId }),
        jeda(ms).then(() => kembalikanHargaErp({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId })),
      ]);

      const menang = [konfirmasi.hasil === "DIKONFIRMASI", kembalikan.hasil === "DIKEMBALIKAN"].filter(Boolean);
      expect(menang).toHaveLength(1);
      const akhir = await fx.baca(id);
      if (konfirmasi.hasil === "DIKONFIRMASI") expect(akhir).toMatchObject({ harga: 120_000, dikonfirmasi: 120_000 });
      else expect(akhir).toMatchObject({ harga: 100_000, dikonfirmasi: 100_000 });
      expect(await kiriman(id)).toBe(1);
    });

    it.each([0, 5])("konfirmasi lawan ubah harga lewat formulir (jeda %i ms): tidak pernah mengonfirmasi harga yang tidak disetujui", async (ms) => {
      const id = await fx.barang({ terpetakan: true, sellingPrice: 120_000, jubelioConfirmedPrice: 100_000 });
      const ubahHarga = () =>
        prisma.$transaction((tx) =>
          updateItemLib(
            tx,
            id,
            { nameId: "Kaos uji harga", nameEn: "Test tee", type: "FINISHED_GOOD", uomId: fx.keadaan.uomId, categoryId: fx.keadaan.kategoriId, sellingPrice: 140_000 },
            { olehUserId: fx.keadaan.userLainId },
          ),
        );
      const [konfirmasi, ubah] = await Promise.allSettled([
        konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "120000.00", olehUserId: fx.keadaan.userId }),
        jeda(ms).then(ubahHarga),
      ]);

      const akhir = await fx.baca(id);
      // Harga 140.000 tidak pernah disetujui siapa pun, jadi tidak boleh menjadi harga Jubelio.
      expect(akhir.dikonfirmasi).not.toBe(140_000);
      if (konfirmasi.status === "fulfilled" && konfirmasi.value.hasil === "DIKONFIRMASI") {
        expect(akhir.dikonfirmasi).toBe(120_000);
      } else if (konfirmasi.status === "fulfilled") {
        expect(konfirmasi.value.hasil).toBe("HARGA_BERUBAH");
        expect(akhir.dikonfirmasi).toBe(100_000);
      }
      if (ubah.status === "fulfilled") {
        // Harga baru tersimpan dan, karena berbeda dari harga terkonfirmasi, kembali menunggu.
        expect(akhir.harga).toBe(140_000);
      }
    });

    it.each([0, 5])("konfirmasi produk baru lawan batalkan pengajuan (jeda %i ms): tepat satu berhasil", async (ms) => {
      const diajukan = new Date("2026-11-02T03:00:00.000Z");
      const id = await fx.barang({ jubelioCreateRequestedAt: diajukan });
      const [konfirmasi, batal] = await Promise.all([
        konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "100000.00", olehUserId: fx.keadaan.userId }),
        jeda(ms).then(() => batalkanPengajuanJubelio({ itemId: id, diajukanPadaDiharapkan: diajukan.toISOString(), olehUserId: fx.keadaan.userId })),
      ]);

      const menang = [konfirmasi.hasil === "DIKONFIRMASI", batal.hasil === "DIBATALKAN"].filter(Boolean);
      expect(menang).toHaveLength(1);
      expect((await fx.baca(id)).diajukanPada).toBeNull();
      expect(await kiriman(id)).toBe(konfirmasi.hasil === "DIKONFIRMASI" ? 1 : 0);
    });
  });
});

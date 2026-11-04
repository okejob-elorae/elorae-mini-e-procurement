import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { withRetry } from "@/lib/db/tx-retry";
import { createItem, updateItem, type ItemFormData } from "./mutations";
import {
  SalesChannelCannotActivateError,
  SalesChannelCannotDeactivateError,
  SalesChannelPushInFlightError,
  SalesChannelRequiredError,
} from "./save-refusals";
import { JEJAK_SALURAN_JUAL, type SaluranJual } from "./saluran-jual";
import { JEJAK_HARGA_JUBELIO } from "@/lib/jubelio/harga/aturan";
import { ajukanKeJubelio } from "@/lib/jubelio/harga/pengajuan";
import { konfirmasiHargaJubelio } from "@/lib/jubelio/harga/writer";
import { buatFixtureHarga } from "@/lib/jubelio/harga/test-fixtures";

/*
 * Saluran jual barang jadi (jawaban pemilik 2026-11-02): P3 dua centang, P3a "Toko offline saja"
 * tidak pernah dikirim ke Jubelio, P72 yang sudah di Jubelio dinonaktifkan (tidak dihapus), P76
 * pemegang items:edit yang memilih. Basis data uji sungguhan, termasuk balapan dengan penulis harga
 * Jubelio; jejak audit ditulis di transaksi yang sama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("saluran jual barang jadi (test bed only)", () => {
  const fx = buatFixtureHarga();
  let bawaanDibuatTes = false;

  beforeAll(async () => {
    bawaanDibuatTes = false;
    // Penonaktifan butuh nilai bawaan kiriman; baris tunggalnya dibuat hanya kalau belum ada, dan dihapus lagi.
    if ((await prisma.jubelioPushDefaults.count()) === 0) {
      await prisma.jubelioPushDefaults.create({ data: { id: "singleton" } });
      bawaanDibuatTes = true;
    }
  });

  afterAll(async () => {
    if (bawaanDibuatTes) await prisma.jubelioPushDefaults.delete({ where: { id: "singleton" } });
  });

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: fx.keadaan.itemIds.map(seededId) } } });
    await fx.bersihkan();
  });

  const isian = (lain: Partial<ItemFormData> = {}): ItemFormData => ({
    nameId: "Kaos uji harga",
    nameEn: "Test tee",
    type: "FINISHED_GOOD",
    uomId: fx.keadaan.uomId,
    categoryId: fx.keadaan.kategoriId,
    sellingPrice: 100_000,
    ...lain,
  });

  // Seperti `runItemUpdate` di aksi barang: korban deadlock diulang utuh.
  const ubah = (id: string, salesChannel: SaluranJual, kategoriId?: string) =>
    withRetry(() =>
      prisma.$transaction((tx) =>
        updateItem(tx, id, isian({ salesChannel, ...(kategoriId ? { categoryId: kategoriId } : {}) }), { olehUserId: fx.keadaan.userId }),
      ),
    );

  const jejak = (itemId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId: seededId(itemId), action }, select: { changes: true } });
  const kirimanProduk = (itemId: string) =>
    prisma.jubelioOutbox.findMany({ where: { entityId: seededId(itemId), entityType: "product_push" }, select: { id: true } });

  async function buatBaru(salesChannel?: SaluranJual) {
    const { item } = await createItem(
      { ...isian({ ...(salesChannel ? { salesChannel } : {}) }), sku: `HJ-SAL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` },
      { olehUserId: fx.keadaan.userId },
    );
    fx.keadaan.itemIds.push(item.id);
    return item.id;
  }

  describe("barang jadi baru", () => {
    it.each([
      ["MARKETPLACE" as const, true],
      ["BOTH" as const, true],
      ["OFFLINE" as const, false],
    ])("%s tersimpan; diajukan ke Jubelio = %s", async (saluran, diajukan) => {
      const id = await buatBaru(saluran);
      const k = await fx.baca(id);
      expect(k.saluran).toBe(saluran);
      expect(k.diajukanPada != null).toBe(diajukan);
    });

    it("tanpa saluran ditolak, tidak ada yang dibuat", async () => {
      const sebelum = await prisma.item.count({ where: { uomId: seededId(fx.keadaan.uomId) } });
      await expect(createItem({ ...isian(), sku: `HJ-SAL-X-${Date.now()}` })).rejects.toBeInstanceOf(SalesChannelRequiredError);
      expect(await prisma.item.count({ where: { uomId: seededId(fx.keadaan.uomId) } })).toBe(sebelum);
    });
  });

  describe("mengubah saluran", () => {
    it("belum di Jubelio + diajukan → Toko offline saja: pengajuan ditutup, dua jejak di transaksi yang sama", async () => {
      const id = await fx.barang({ jubelioCreateRequestedAt: new Date("2026-11-02T03:00:00.000Z") });
      const r = await ubah(id, "OFFLINE");

      expect(r.kirimanSaluran).toBeNull();
      expect(await fx.baca(id)).toMatchObject({ saluran: "OFFLINE", diajukanPada: null, diajukanOleh: null });
      const batal = await jejak(id, JEJAK_HARGA_JUBELIO.PENGAJUAN_DIBATALKAN);
      expect(batal).toHaveLength(1);
      expect(batal[0].changes).toMatchObject({ sebab: "SALURAN_OFFLINE" });
      const saluran = await jejak(id, JEJAK_SALURAN_JUAL);
      expect(saluran.map((a) => a.changes)).toEqual([{ before: "BOTH", after: "OFFLINE", pengajuan: "DIBATALKAN", kiriman: null }]);
      expect(await kirimanProduk(id)).toHaveLength(0);
    });

    it("Toko offline saja → Keduanya (barang ERP belum di Jubelio): diajukan", async () => {
      const id = await fx.barang({ salesChannel: "OFFLINE" });
      await ubah(id, "BOTH");
      expect((await fx.baca(id)).diajukanPada).toBeInstanceOf(Date);
      expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ pengajuan: "DIAJUKAN", kiriman: null });
    });

    it("sudah di Jubelio → Toko offline saja: tepat satu kiriman penonaktifan, jejak NONAKTIFKAN (P72)", async () => {
      const id = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000 });
      const r = await ubah(id, "OFFLINE");

      const kiriman = await kirimanProduk(id);
      expect(kiriman).toHaveLength(1);
      expect(r.kirimanSaluran).toEqual({ outboxId: kiriman[0].id });
      expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ before: "BOTH", after: "OFFLINE", kiriman: "NONAKTIFKAN" });
    });

    it.each([
      ["tanpa harga terkonfirmasi", { jubelioConfirmedPrice: null }, "TANPA_HARGA_TERKONFIRMASI"],
      ["kategori belum dipetakan", { kategori: "tidak" as const }, "KATEGORI_BELUM_DIPETAKAN"],
    ])("sudah di Jubelio → Toko offline saja ditolak bila %s; tidak ada yang tersimpan", async (_label, lain, alasan) => {
      const id = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000, ...lain });
      const kategori = "kategori" in lain ? fx.keadaan.kategoriTanpaPetaId : undefined;
      const galat = await ubah(id, "OFFLINE", kategori).catch((e: unknown) => e);
      expect(galat).toBeInstanceOf(SalesChannelCannotDeactivateError);
      expect((galat as SalesChannelCannotDeactivateError).alasan).toBe(alasan);
      expect((await fx.baca(id)).saluran).toBe("BOTH");
      expect(await jejak(id, JEJAK_SALURAN_JUAL)).toHaveLength(0);
      expect(await kirimanProduk(id)).toHaveLength(0);
    });

    it("Toko offline saja yang sudah di Jubelio → Keduanya: satu kiriman pengaktifan; kategori belum dipetakan ditolak", async () => {
      const id = await fx.barang({ salesChannel: "OFFLINE", terpetakan: true, jubelioConfirmedPrice: 100_000 });
      await ubah(id, "BOTH");
      expect(await kirimanProduk(id)).toHaveLength(1);
      expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ kiriman: "AKTIFKAN" });

      const lain = await fx.barang({ salesChannel: "OFFLINE", terpetakan: true, jubelioConfirmedPrice: 100_000, kategori: "tidak" });
      await expect(ubah(lain, "BOTH", fx.keadaan.kategoriTanpaPetaId)).rejects.toBeInstanceOf(SalesChannelCannotActivateError);
      expect((await fx.baca(lain)).saluran).toBe("OFFLINE");
    });

    it("kiriman produk yang masih berjalan menolak perubahan apa pun", async () => {
      const id = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000 });
      await fx.kiriman(id, { status: "PENDING" });
      await expect(ubah(id, "MARKETPLACE")).rejects.toBeInstanceOf(SalesChannelPushInFlightError);
      expect((await fx.baca(id)).saluran).toBe("BOTH");
    });

    it("Marketplace ↔ Keduanya: tanpa akibat ke Jubelio; simpan tanpa perubahan saluran tanpa jejak", async () => {
      const id = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000 });
      await ubah(id, "MARKETPLACE");
      expect(await kirimanProduk(id)).toHaveLength(0);
      expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ pengajuan: null, kiriman: null });
      await ubah(id, "MARKETPLACE");
      expect(await jejak(id, JEJAK_SALURAN_JUAL)).toHaveLength(1);
    });
  });

  /*
   * Balapan. Baris barang dikunci lebih dulu oleh ubahan, dan penulis harga berjalan serializable,
   * jadi keduanya antre. Penulis yang lebih pendek dimulai beberapa milidetik lebih lambat di
   * putaran kedua, supaya tes tidak lolos karena satu penulis selalu sampai duluan.
   */
  describe("balapan", () => {
    it.each([0, 5])("ubah ke Toko offline saja lawan konfirmasi produk baru (jeda %i ms): satu keadaan akhir yang konsisten", async (ms) => {
      const id = await fx.barang({ jubelioCreateRequestedAt: new Date("2026-11-02T03:00:00.000Z") });
      const [ubahan, konfirmasi] = await Promise.allSettled([
        ubah(id, "OFFLINE"),
        jeda(ms).then(() => konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "100000.00", berubahPadaDiharapkan: null, olehUserId: fx.keadaan.userId })),
      ]);
      const akhir = await fx.baca(id);
      const kiriman = await kirimanProduk(id);

      if (konfirmasi.status === "fulfilled" && konfirmasi.value.hasil === "DIKONFIRMASI") {
        // Konfirmasi duluan: kirimannya menunggu, jadi ubahan ditolak dan tidak menyimpan apa pun.
        expect(ubahan.status).toBe("rejected");
        expect(ubahan.status === "rejected" && ubahan.reason).toBeInstanceOf(SalesChannelPushInFlightError);
        expect(akhir).toMatchObject({ saluran: "BOTH", dikonfirmasi: 100_000 });
        expect(kiriman).toHaveLength(1);
        expect(await jejak(id, JEJAK_SALURAN_JUAL)).toHaveLength(0);
      } else {
        // Ubahan duluan: barang offline, pengajuan ditutup, konfirmasi tidak menemukan yang menunggu.
        expect(ubahan.status).toBe("fulfilled");
        expect(konfirmasi.status === "fulfilled" && konfirmasi.value.hasil).toBe("TIDAK_MENUNGGU");
        expect(akhir).toMatchObject({ saluran: "OFFLINE", diajukanPada: null, dikonfirmasi: null });
        expect(kiriman).toHaveLength(0);
        expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ pengajuan: "DIBATALKAN" });
      }
    });

    it.each([0, 5])("Toko offline saja → Keduanya lawan Ajukan ke Jubelio (jeda %i ms): tepat satu tanda pengajuan", async (ms) => {
      const id = await fx.barang({ salesChannel: "OFFLINE" });
      const [ubahan, ajukan] = await Promise.allSettled([ubah(id, "BOTH"), jeda(ms).then(() => ajukanKeJubelio([id], fx.keadaan.userLainId))]);

      expect(ubahan.status).toBe("fulfilled");
      expect(ajukan.status).toBe("fulfilled");
      const hasil = ajukan.status === "fulfilled" ? ajukan.value[0]?.hasil : null;
      expect(["SALURAN_OFFLINE", "SUDAH_DIAJUKAN"]).toContain(hasil);
      const akhir = await fx.baca(id);
      expect(akhir.saluran).toBe("BOTH");
      // Ubahan yang mengajukan — siapa pun yang duluan — dan jejaknya berkata begitu.
      expect(akhir.diajukanOleh).toBe(fx.keadaan.userId);
      expect((await jejak(id, JEJAK_SALURAN_JUAL))[0].changes).toMatchObject({ pengajuan: "DIAJUKAN" });
    });
  });
});

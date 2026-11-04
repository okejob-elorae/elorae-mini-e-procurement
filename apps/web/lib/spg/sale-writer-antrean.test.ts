import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { tandaiSpgBerhenti } from "@/lib/users/spg-berhenti-writer";
import { JEJAK_SPG_BERHENTI } from "@/lib/users/spg-berhenti";
import { recordSpgSale } from "./sale-writer";
import { JEJAK_KATEGORI_BARANG } from "./kategori-saat-jual";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Dua aturan penulis nota SPG untuk nota yang sampai belakangan, terhadap basis data sungguhan:
 *
 * - SPG yang ditandai berhenti (P66) SESUDAH aksi jualnya lolos: penulis membaca ulang penandanya
 *   di transaksinya sendiri. Nota yang dijual sesudah hari terakhirnya, atau di toko lain, ditolak
 *   `SPG_BERHENTI` tanpa satu baris pun; yang dijual di tokonya sampai hari terakhirnya dicatat.
 * - Kategori saat terjual (P8): nota antrean HP yang kategori barangnya diubah sesudah waktu
 *   jualnya menyimpan kategori yang berlaku saat terjual, dari jejak `JEJAK_KATEGORI_BARANG`.
 *
 * Semua baris diseed di sini dan dihapus lewat `seededId(s)`.
 */
d("recordSpgSale — nota yang sampai belakangan (test bed only)", () => {
  const tag = `SWA${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date("2026-11-04T10:00:00+07:00");
  let toko = "";
  let tokoLain = "";
  let kantor = "";
  let dewi = "";
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let itemId = "";

  const tokoIds = () => [toko, tokoLain].filter(Boolean);
  const jual = (opsi: { storeId?: string; luring?: boolean; waktuJual?: Date; kunci: string }) =>
    recordSpgSale({
      salesmanId: dewi,
      storeId: opsi.storeId ?? toko,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      luring: opsi.luring,
      waktuJual: opsi.waktuJual ?? null,
      sekarang,
      idempotencyKey: `${tag}-${opsi.kunci}`,
    });
  const notaDewi = () => prisma.spgSale.count({ where: { salesmanId: seededId(dewi) } });

  beforeAll(async () => {
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-L`, name: `Toko lain ${tag}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    dewi = (await prisma.user.create({ data: { email: `${tag}-dewi@test.local`, name: `Dewi ${tag}` } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (await prisma.itemCategory.create({ data: { code: `${tag}-KAOS`, name: `Kaos ${tag}`, isActive: true } })).id;
    kemeja = (await prisma.itemCategory.create({ data: { code: `${tag}-KEMEJA`, name: `Kemeja ${tag}`, isActive: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000, categoryId: kaos },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: dewi }, data: { assignedStoreId: toko, spgStartedOn: "2026-09-01", spgEndedOn: null, spgEndedStoreId: null } });
    await prisma.item.update({ where: { id: itemId }, data: { categoryId: kaos } });
  });

  afterEach(async () => {
    const nota = await prisma.spgSale.findMany({ where: { salesmanId: seededId(dewi) }, select: { id: true } });
    const notaIds = nota.map((n) => n.id);
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(tokoIds()) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: seededIds(notaIds) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(notaIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: seededId(dewi) } });
    await prisma.auditLog.deleteMany({ where: { action: JEJAK_KATEGORI_BARANG, entityType: "Item", entityId: seededId(itemId) } });
  });

  afterAll(async () => {
    if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([kaos, kemeja].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([dewi, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds()) } } });
  });

  describe("SPG yang ditandai berhenti (P66)", () => {
    beforeEach(async () => {
      expect(await tandaiSpgBerhenti({ userId: dewi, hariTerakhir: "2026-11-03", alasan: "mengundurkan diri", olehUserId: kantor, sekarang })).toEqual({
        ok: true,
      });
      const jejak = await prisma.auditLog.count({ where: { entityType: "User", entityId: seededId(dewi), action: JEJAK_SPG_BERHENTI.DITANDAI } });
      expect(jejak).toBe(1);
    });

    it("nota yang dijual sesudah hari terakhirnya ditolak SPG_BERHENTI, tanpa satu baris pun", async () => {
      // Dijual di konter "sekarang" (4 Nov) — sehari sesudah hari terakhirnya.
      expect(await jual({ kunci: "konter" })).toEqual({ ok: false, code: "SPG_BERHENTI" });
      // Dari antrean HP, tertangkap sesudah akhir hari terakhirnya (WIB).
      expect(await jual({ kunci: "antre-lewat", luring: true, waktuJual: new Date("2026-11-04T00:00:01+07:00") })).toEqual({
        ok: false,
        code: "SPG_BERHENTI",
      });
      expect(await notaDewi()).toBe(0);
      expect(await prisma.storeStockMovement.count({ where: { storeId: seededId(toko) } })).toBe(0);
      expect(await prisma.salesHistory.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    });

    it("nota yang dijual di hari terakhirnya, di tokonya, tetap dicatat", async () => {
      const waktuJual = new Date("2026-11-03T23:59:00+07:00");
      const hasil = await jual({ kunci: "antre-terakhir", luring: true, waktuJual });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) return;
      const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: seededId(hasil.spgSaleId) }, select: { storeId: true, createdAt: true } });
      expect(nota).toEqual({ storeId: toko, createdAt: waktuJual });
    });

    it("nota di hari terakhirnya tetapi di toko lain ditolak SPG_BERHENTI", async () => {
      expect(await jual({ kunci: "antre-lain", storeId: tokoLain, luring: true, waktuJual: new Date("2026-11-03T12:00:00+07:00") })).toEqual({
        ok: false,
        code: "SPG_BERHENTI",
      });
      expect(await notaDewi()).toBe(0);
    });
  });

  describe("balapan dengan penanda berhenti (B25/B26)", () => {
    it("penanda berhenti dan nota konter serentak: tepat satu yang lolos, tidak pernah keduanya", async () => {
      // Nota dimulai beberapa ms kemudian: tanpa pembacaan ulang di transaksinya, penanda yang
      // menang lebih dulu membiarkan nota sesudah hari terakhir tetap tercatat — tes ini gagal.
      const [berhenti, nota] = await Promise.all([
        tandaiSpgBerhenti({ userId: dewi, hariTerakhir: "2026-11-03", alasan: "uji balapan", olehUserId: kantor, sekarang }),
        new Promise((r) => setTimeout(r, 5)).then(() => jual({ kunci: "balapan" })),
      ]);
      expect([berhenti.ok, nota.ok].filter(Boolean)).toHaveLength(1);
      if (berhenti.ok) {
        expect(nota).toEqual({ ok: false, code: "SPG_BERHENTI" });
        expect(await notaDewi()).toBe(0);
      } else {
        // Notanya menang: penjualan 4 Nov sesudah hari terakhir yang diminta, penandanya ditolak.
        expect(berhenti).toEqual({ ok: false, kode: "ADA_KEGIATAN_SESUDAH" });
        expect(await notaDewi()).toBe(1);
      }
    });
  });

  describe("kategori saat terjual (P8)", () => {
    const waktuJual = new Date(sekarang.getTime() - 3 * 3_600_000);

    /** Kantor mengubah kategori barang dari kaos ke kemeja satu jam sebelum notanya sampai. */
    const ubahKeKemeja = async () => {
      await prisma.auditLog.create({
        data: {
          userId: kantor,
          action: JEJAK_KATEGORI_BARANG,
          entityType: "Item",
          entityId: itemId,
          changes: { before: { categoryId: kaos }, after: { categoryId: kemeja } },
          createdAt: new Date(sekarang.getTime() - 3_600_000),
        },
      });
      await prisma.item.update({ where: { id: itemId }, data: { categoryId: kemeja } });
    };
    const kategoriBaris = async (spgSaleId: string) =>
      prisma.spgSaleLine.findMany({
        where: { spgSaleId: seededId(spgSaleId) },
        select: { categoryId: true, categoryAt: true, categoryFilledLater: true },
      });

    it("nota antrean HP yang sampai sesudah kategori barangnya diubah menyimpan kategori hari terjualnya", async () => {
      await ubahKeKemeja();
      const hasil = await jual({ kunci: "kategori-antre", luring: true, waktuJual });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) return;
      expect(await kategoriBaris(hasil.spgSaleId)).toEqual([{ categoryId: kaos, categoryAt: waktuJual, categoryFilledLater: false }]);
    });

    it("nota konter tetap memakai kategori master saat dibaca (perilaku lama)", async () => {
      await ubahKeKemeja();
      const hasil = await jual({ kunci: "kategori-konter" });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) return;
      expect(await kategoriBaris(hasil.spgSaleId)).toEqual([{ categoryId: kemeja, categoryAt: sekarang, categoryFilledLater: false }]);
    });

    it("nota antrean HP tanpa perubahan kategori sesudah waktu jualnya: kategori master, dicatat saat dibaca", async () => {
      const hasil = await jual({ kunci: "kategori-tetap", luring: true, waktuJual });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) return;
      expect(await kategoriBaris(hasil.spgSaleId)).toEqual([{ categoryId: kaos, categoryAt: sekarang, categoryFilledLater: false }]);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { updateItem, type ItemFormData } from "./mutations";
import { buatFixtureHarga } from "@/lib/jubelio/harga/test-fixtures";
import { JEJAK_KATEGORI_BARANG, jejakKategoriSesudah, kategoriSaatJual } from "@/lib/spg/kategori-saat-jual";

/*
 * Jejak perubahan kategori barang (pemilik P8/P69): setiap perubahan `Item.categoryId` lewat
 * `updateItem` menulis satu baris `JEJAK_KATEGORI_BARANG` di transaksi yang sama, dengan pasangan
 * sebelum/sesudah — bentuk yang dibaca `jejakKategoriSesudah` untuk nota SPG dari antrean HP yang
 * sampai sesudah kategorinya diubah. Basis data uji sungguhan, penulis sungguhan.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("updateItem — jejak perubahan kategori (test bed only)", () => {
  const fx = buatFixtureHarga();

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

  const ubah = (id: string, lain: Partial<ItemFormData>) =>
    prisma.$transaction((tx) => updateItem(tx, id, isian(lain), { olehUserId: fx.keadaan.userId }));

  const jejak = (itemId: string) =>
    prisma.auditLog.findMany({
      where: { entityId: seededId(itemId), action: JEJAK_KATEGORI_BARANG },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { userId: true, entityType: true, changes: true },
    });

  it("kategori diganti: satu jejak dengan kategori sebelum dan sesudah, oleh pengubahnya", async () => {
    const id = await fx.barang();
    await ubah(id, { categoryId: fx.keadaan.kategoriTanpaPetaId });

    expect(await jejak(id)).toEqual([
      {
        userId: fx.keadaan.userId,
        entityType: "Item",
        changes: { before: { categoryId: fx.keadaan.kategoriId }, after: { categoryId: fx.keadaan.kategoriTanpaPetaId } },
      },
    ]);
  });

  it("kategori dikosongkan dan diberikan: keduanya tercatat, kosong sebagai null", async () => {
    const id = await fx.barang();
    await ubah(id, { categoryId: "" });
    await ubah(id, { categoryId: fx.keadaan.kategoriTanpaPetaId });

    expect((await jejak(id)).map((j) => j.changes)).toEqual([
      { before: { categoryId: fx.keadaan.kategoriId }, after: { categoryId: null } },
      { before: { categoryId: null }, after: { categoryId: fx.keadaan.kategoriTanpaPetaId } },
    ]);
  });

  it("kategori sama: tidak ada jejak", async () => {
    const id = await fx.barang();
    await ubah(id, { nameId: "Kaos uji harga baru" });

    expect(await jejak(id)).toEqual([]);
  });

  it("ubahan yang ditolak tidak mengubah kategori dan tidak meninggalkan jejak", async () => {
    const id = await fx.barang();
    await expect(ubah(id, { categoryId: fx.keadaan.kategoriTanpaPetaId, targetMarginPercent: 100, priceRuleBasis: "MARGIN" })).rejects.toThrow(
      /Margin harus/,
    );

    expect(await jejak(id)).toEqual([]);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: seededId(id) }, select: { categoryId: true } })).categoryId).toBe(
      fx.keadaan.kategoriId,
    );
  });

  it("nota antrean HP yang terjual sebelum perubahan membaca kategori lamanya dari jejak ini", async () => {
    const id = await fx.barang();
    const terjual = new Date(Date.now() - 60_000);
    await ubah(id, { categoryId: fx.keadaan.kategoriTanpaPetaId });
    const dibaca = new Date();

    const perubahan = await prisma.$transaction((tx) => jejakKategoriSesudah(tx, [id], terjual));
    const baris = kategoriSaatJual({ sekarangId: fx.keadaan.kategoriTanpaPetaId, jejak: perubahan.get(id), waktu: terjual, dibaca });

    expect(baris).toEqual({ categoryId: fx.keadaan.kategoriId, categoryAt: terjual, categoryFilledLater: false });
  });
});

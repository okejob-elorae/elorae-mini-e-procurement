import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { updateItem, type ItemFormData } from "./mutations";
import { buatFixtureHarga } from "@/lib/jubelio/harga/test-fixtures";

/*
 * Batas persen rekomendasi (R14: markup 0–999,99, margin 0–99,99) diperiksa di server untuk SETIAP
 * gabungan isian (jawaban pemilik P4: satu rekomendasi, diisi sebagai markup ATAU margin). Dasar
 * yang dikirim tanpa persennya memeriksa persen TERSIMPAN dengan dasar baru, supaya markup 178
 * tidak tersimpan diam-diam sebagai margin 178 — pasangan itu dibuang `rekomendasiHargaJual`, dan
 * rekomendasi barangnya hilang. Basis data uji sungguhan, penulis sungguhan.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("updateItem — dasar aturan harga tanpa persen (test bed only)", () => {
  const fx = buatFixtureHarga();

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: fx.keadaan.itemIds.map(seededId) } } });
    await fx.bersihkan();
  });

  // Isian wajib yang sama dengan barangnya; persen rekomendasi sengaja tidak dikirim.
  const isian = (lain: Partial<ItemFormData> = {}): ItemFormData => ({
    nameId: "Kaos uji harga",
    nameEn: "Test tee",
    type: "FINISHED_GOOD",
    uomId: fx.keadaan.uomId,
    categoryId: fx.keadaan.kategoriId,
    sellingPrice: 100_000,
    ...lain,
  });

  async function barangDenganAturan(persen: number) {
    const id = await fx.barang();
    await prisma.item.update({
      where: { id: seededId(id) },
      data: { priceRuleBasis: "MARKUP", targetMarginPercent: persen },
    });
    return id;
  }

  async function aturan(id: string) {
    const b = await prisma.item.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { priceRuleBasis: true, targetMarginPercent: true },
    });
    return { dasar: b.priceRuleBasis, persen: b.targetMarginPercent == null ? null : Number(b.targetMarginPercent) };
  }

  const keMargin = (id: string) =>
    prisma.$transaction((tx) => updateItem(tx, id, isian({ priceRuleBasis: "MARGIN" }), { olehUserId: fx.keadaan.userId }));

  it("markup 178 tersimpan, dasar diubah ke MARGIN tanpa persen → ditolak, dasarnya tetap MARKUP", async () => {
    const id = await barangDenganAturan(178);

    await expect(keMargin(id)).rejects.toThrow(/targetMarginPercent: Margin harus 0 sampai 99,99/);

    expect(await aturan(id)).toEqual({ dasar: "MARKUP", persen: 178 });
  });

  it("persen tersimpan 40 masih sah sebagai margin → tersimpan MARGIN/40", async () => {
    const id = await barangDenganAturan(40);

    await keMargin(id);

    expect(await aturan(id)).toEqual({ dasar: "MARGIN", persen: 40 });
  });
});

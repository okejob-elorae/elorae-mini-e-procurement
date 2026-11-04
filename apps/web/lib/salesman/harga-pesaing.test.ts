import { describe, expect, it } from "vitest";
import {
  BATAS_HARGA_PESAING,
  JEDA_KIRIM_ULANG_MS,
  kirimanUlang,
  kunciTeks,
  periksaHargaPesaing,
  ringkasHargaPesaing,
} from "./harga-pesaing";

const sah = { brand: "Nevada", productName: "Kaos polos", category: "Kaos", price: 89000, note: null, photoUrl: null };

describe("periksaHargaPesaing", () => {
  it("menerima isian sah dan merapikan spasi", () => {
    expect(
      periksaHargaPesaing({
        brand: "  Nevada ",
        productName: "Kaos   polos",
        category: " Kaos ",
        price: 89000,
        note: "  promo 2 pcs  ",
        photoUrl: "/api/foto/abc123",
      }),
    ).toEqual({
      ok: true,
      nilai: { brand: "Nevada", productName: "Kaos polos", category: "Kaos", price: 89000, note: "promo 2 pcs", photoUrl: "/api/foto/abc123" },
    });
  });

  it("kategori, catatan dan foto opsional", () => {
    expect(periksaHargaPesaing({ ...sah, category: "  ", note: "", photoUrl: "" })).toEqual({
      ok: true,
      nilai: { ...sah, category: null },
    });
  });

  it("merek dan produk wajib", () => {
    expect(periksaHargaPesaing({ ...sah, brand: "  " })).toEqual({ ok: false, kode: "MEREK_WAJIB" });
    expect(periksaHargaPesaing({ ...sah, productName: undefined })).toEqual({ ok: false, kode: "PRODUK_WAJIB" });
    expect(periksaHargaPesaing(null)).toEqual({ ok: false, kode: "MEREK_WAJIB" });
  });

  it("harga harus angka positif dalam batas; dibulatkan ke sen", () => {
    for (const price of [0, -5, "89000", Number.NaN, Number.POSITIVE_INFINITY, BATAS_HARGA_PESAING.hargaMaks + 1]) {
      expect(periksaHargaPesaing({ ...sah, price })).toEqual({ ok: false, kode: "HARGA_TIDAK_SAH" });
    }
    expect(periksaHargaPesaing({ ...sah, price: 1000.456 })).toMatchObject({ ok: true, nilai: { price: 1000.46 } });
  });

  it("teks yang terlalu panjang ditolak", () => {
    expect(periksaHargaPesaing({ ...sah, brand: "x".repeat(BATAS_HARGA_PESAING.merek + 1) })).toEqual({
      ok: false,
      kode: "TEKS_TERLALU_PANJANG",
    });
    expect(periksaHargaPesaing({ ...sah, note: "x".repeat(BATAS_HARGA_PESAING.catatan + 1) })).toEqual({
      ok: false,
      kode: "TEKS_TERLALU_PANJANG",
    });
  });

  it("foto hanya dari unggahan sendiri", () => {
    for (const photoUrl of ["https://contoh.com/a.jpg", "/api/foto/", "/api/foto/../x", 5]) {
      expect(periksaHargaPesaing({ ...sah, photoUrl })).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    }
  });
});

describe("kunciTeks", () => {
  it("huruf kecil, tanpa spasi berlebih", () => {
    expect(kunciTeks("  NeVada   Jeans ")).toBe("nevada jeans");
    expect(kunciTeks(null)).toBe("");
  });
});

describe("kirimanUlang", () => {
  const t0 = new Date("2026-09-30T03:00:00.000Z");

  it("isi sama dalam jeda → kiriman ulang", () => {
    expect(kirimanUlang({ ...sah, brand: "nevada" }, { ...sah, createdAt: t0 }, new Date(t0.getTime() + 60_000))).toBe(true);
  });

  it("lewat jeda, harga beda, atau produk beda → bukan", () => {
    expect(kirimanUlang(sah, { ...sah, createdAt: t0 }, new Date(t0.getTime() + JEDA_KIRIM_ULANG_MS + 1))).toBe(false);
    expect(kirimanUlang({ ...sah, price: 90000 }, { ...sah, createdAt: t0 }, t0)).toBe(false);
    expect(kirimanUlang({ ...sah, productName: "Kemeja" }, { ...sah, createdAt: t0 }, t0)).toBe(false);
    expect(kirimanUlang({ ...sah, category: null }, { ...sah, createdAt: t0 }, t0)).toBe(false);
  });
});

describe("ringkasHargaPesaing", () => {
  it("min/rata/maks per merek × kategori, ejaan terbanyak dipakai", () => {
    const r = ringkasHargaPesaing([
      { brand: "Nevada", category: "Kaos", price: 80000 },
      { brand: "nevada", category: "kaos", price: 100000 },
      { brand: "Nevada", category: "Kaos", price: 90000 },
      { brand: "Nevada", category: null, price: 150000 },
      { brand: "3Second", category: "Kemeja", price: 199000 },
    ]);
    expect(r).toEqual([
      { merek: "3Second", kategori: "Kemeja", jumlah: 1, min: 199000, rata: 199000, maks: 199000 },
      { merek: "Nevada", kategori: "Kaos", jumlah: 3, min: 80000, rata: 90000, maks: 100000 },
      { merek: "Nevada", kategori: null, jumlah: 1, min: 150000, rata: 150000, maks: 150000 },
    ]);
  });

  it("rata-rata dibulatkan ke rupiah", () => {
    const r = ringkasHargaPesaing([
      { brand: "A", category: null, price: 1 },
      { brand: "A", category: null, price: 2 },
      { brand: "A", category: null, price: 2 },
    ]);
    expect(r[0].rata).toBe(2);
  });

  it("kosong → kosong", () => {
    expect(ringkasHargaPesaing([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  saringSaranUmum,
  alasanDariSaranTawar,
  bisaDibatalkan,
  bisaDijawab,
  bisaDipesan,
  bolehBuatRekomendasi,
  catatanSetujuToko,
  namaBarisRekomendasi,
  opsiVarianBarang,
  rapikanBarisRekomendasi,
  rapikanTeksRekomendasi,
  skuVarianBarang,
} from "./rekomendasi-aturan";

describe("bolehBuatRekomendasi", () => {
  it("pemegang toko boleh; salesman lain tidak, terkunci atau tidak", () => {
    expect(bolehBuatRekomendasi({ terkunci: false, pemegangId: "a", userId: "a" })).toBe(true);
    expect(bolehBuatRekomendasi({ terkunci: true, pemegangId: "a", userId: "a" })).toBe(true);
    expect(bolehBuatRekomendasi({ terkunci: false, pemegangId: "a", userId: "b" })).toBe(false);
    expect(bolehBuatRekomendasi({ terkunci: true, pemegangId: "a", userId: "b" })).toBe(false);
  });

  it("toko tanpa pemegang: terbuka selama kunci mati, tertutup saat kunci menyala", () => {
    expect(bolehBuatRekomendasi({ terkunci: false, pemegangId: null, userId: "b" })).toBe(true);
    expect(bolehBuatRekomendasi({ terkunci: true, pemegangId: null, userId: "b" })).toBe(false);
  });
});

describe("rapikanBarisRekomendasi", () => {
  it("menerima baris yang benar; varian kosong/null = barang tanpa varian; alasan bawaan MANUAL", () => {
    expect(
      rapikanBarisRekomendasi([
        { itemId: " i1 ", variantSku: "S-M", qty: 6, alasan: "LAKU_DI_SINI" },
        { itemId: "i2", variantSku: null, qty: 1 },
      ]),
    ).toEqual({
      ok: true,
      baris: [
        { itemId: "i1", variantSku: "S-M", qty: 6, alasan: "LAKU_DI_SINI" },
        { itemId: "i2", variantSku: "", qty: 1, alasan: "MANUAL" },
      ],
    });
  });

  it("menolak kosong, jumlah tidak bulat/nol, alasan asing, dan barang × ukuran ganda", () => {
    expect(rapikanBarisRekomendasi([])).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(rapikanBarisRekomendasi(null)).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(rapikanBarisRekomendasi([{ itemId: "i1", qty: 1.5 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisRekomendasi([{ itemId: "i1", qty: 0 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisRekomendasi([{ itemId: "i1", qty: 1, alasan: "HARGA" }])).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(rapikanBarisRekomendasi([{ itemId: "", qty: 1 }])).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(
      rapikanBarisRekomendasi([
        { itemId: "i1", variantSku: "M", qty: 1 },
        { itemId: "i1", variantSku: "M", qty: 2 },
      ]),
    ).toEqual({ ok: false, kode: "BARIS_GANDA" });
    expect(rapikanBarisRekomendasi(Array.from({ length: 101 }, (_, i) => ({ itemId: `i${i}`, qty: 1 })))).toEqual({
      ok: false,
      kode: "TERLALU_BANYAK_BARIS",
    });
  });
});

describe("teks dan status", () => {
  it("alasan tolak wajib; catatan boleh kosong; teks terlalu panjang ditolak", () => {
    expect(rapikanTeksRekomendasi("  ", true)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanTeksRekomendasi(undefined, false)).toEqual({ ok: true, teks: null });
    expect(rapikanTeksRekomendasi(" stok penuh ", true)).toEqual({ ok: true, teks: "stok penuh" });
    expect(rapikanTeksRekomendasi("x".repeat(501), false)).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
  });

  it("siapa bisa apa di status mana", () => {
    expect(bisaDijawab("TERKIRIM")).toBe(true);
    expect(bisaDijawab("DITERIMA")).toBe(false);
    expect(bisaDibatalkan("TERKIRIM")).toBe(true);
    expect(bisaDibatalkan("DITERIMA")).toBe(true);
    expect(bisaDibatalkan("SELESAI")).toBe(false);
    expect(bisaDipesan("DITERIMA")).toBe(true);
    expect(bisaDipesan("TERKIRIM")).toBe(false);
  });

  it("alasan saran tawar dan catatan toko setuju", () => {
    expect(alasanDariSaranTawar("LARIS_DI_AREA")).toBe("LAKU_DI_TOKO_LAIN");
    expect(alasanDariSaranTawar("BARU")).toBe("BARANG_BARU");
    expect(alasanDariSaranTawar("ANDALAN_TOKO")).toBe("LAKU_DI_SINI");
    expect(catatanSetujuToko("WHATSAPP", null)).toBe("Toko setuju lewat WhatsApp");
    expect(catatanSetujuToko("LANGSUNG", "Bu Ani")).toBe("Toko setuju langsung: Bu Ani");
  });
});

describe("varian barang", () => {
  it("SKU varian dibaca dari larik atau teks JSON dengan kunci huruf campuran", () => {
    expect(skuVarianBarang([{ sku: "A-M" }, { SKU: "A-L" }, { size: "XL" }])).toEqual(["A-M", "A-L"]);
    expect(skuVarianBarang('[{"Sku":"A-M","Size":"M"}]')).toEqual(["A-M"]);
    expect(skuVarianBarang("bukan json")).toEqual([]);
    expect(skuVarianBarang(null)).toEqual([]);
  });

  it("pilihan ukuran = master (urutannya) lalu yang hanya di stok gudang, berlabel, tanpa ganda; barang tanpa varian = kosong", () => {
    const opsi = opsiVarianBarang({
      variants: [
        { sku: "KAOS-HTM-M", size: "M", color: "Hitam" },
        { sku: "KAOS-HTM-L", size: "L", color: "Hitam" },
      ],
      skuInduk: "KAOS",
      skuStok: ["KAOS-HTM-XL", "KAOS-HTM-M", null, ""],
    });
    expect(opsi).toEqual([
      { sku: "KAOS-HTM-M", label: "Hitam · M" },
      { sku: "KAOS-HTM-L", label: "Hitam · L" },
      { sku: "KAOS-HTM-XL", label: "HTM · XL" },
    ]);
    expect(opsiVarianBarang({ variants: null, skuInduk: "X", skuStok: [null, ""] })).toEqual([]);
    expect(namaBarisRekomendasi("Kaos", "Hitam · M")).toBe("Kaos — Hitam · M");
    expect(namaBarisRekomendasi("Kaos", null)).toBe("Kaos");
  });
});

describe("saringSaranUmum", () => {
  it("drops general suggestions for goods already on this store's shelf", () => {
    const saran = [
      { itemId: "kemeja", alasan: "BARU" },
      { itemId: "kaos", alasan: "LARIS_DI_AREA" },
      { itemId: "jaket", alasan: "BARU" },
    ];
    // Kemeja & jaket masuk lewat opname awal: ada di penyerapan, lambat.
    expect(saringSaranUmum(saran, ["kemeja", "jaket"]).map((s) => s.itemId)).toEqual(["kaos"]);
    expect(saringSaranUmum(saran, [])).toHaveLength(3);
  });
});

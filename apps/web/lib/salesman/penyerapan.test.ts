import { describe, expect, it } from "vitest";
import { labelVarianSerap, nilaiSerap, susunPenyerapan, type BahanSerap, type InfoBarangSerap } from "./penyerapan";

const HARI_INI = new Date("2026-06-15T10:00:00+07:00");
const hariLalu = (n: number) => new Date(HARI_INI.getTime() - n * 86_400_000);
const dasar = { awal: 0, masuk: 0, tambahLain: 0, laku: 0, sisa: 0, umurHari: 60, perkiraan: false };

const bahan = (x: Partial<BahanSerap> & { itemId: string }): BahanSerap => ({
  variantSku: "",
  awal: 0,
  masuk: 0,
  tambahLain: 0,
  laku: 0,
  sisa: 0,
  pertamaMasuk: hariLalu(60),
  perkiraan: false,
  ...x,
});

const barang = new Map<string, InfoBarangSerap>([
  ["kaos", { nama: "Kaos", sku: "KAOS", variants: [{ sku: "KAOS-HTM-M", size: "M", color: "Hitam" }, { sku: "KAOS-HTM-L", size: "L", color: "Hitam" }] }],
  ["kemeja", { nama: "Kemeja", sku: "KMJ", variants: null }],
  ["topi", { nama: "Topi", sku: "TOPI", variants: null }],
  ["celana", { nama: "Celana", sku: "CLN", variants: null }],
  ["baru", { nama: "Baru", sku: "BARU", variants: null }],
]);

describe("nilaiSerap", () => {
  it("terserap = laku ÷ (awal + masuk); 50% ke atas cepat", () => {
    const n = nilaiSerap({ ...dasar, awal: 4, masuk: 6, laku: 6, sisa: 4 }, 91, true);
    expect(n).toMatchObject({ awal: 4, persen: 60, status: "CEPAT" });
  });

  it("di bawah 20% dan sudah lama = lambat; lambat yang masih di rak disarankan jangan dikirim", () => {
    const n = nilaiSerap({ ...dasar, masuk: 20, laku: 2, sisa: 18, umurHari: 80 }, 91, true);
    expect(n).toMatchObject({ persen: 10, status: "LAMBAT", saran: "JANGAN_KIRIM", saranQty: 0 });
  });

  it("di antara keduanya = normal", () => {
    expect(nilaiSerap({ ...dasar, masuk: 10, laku: 3, sisa: 7 }, 91, true).status).toBe("NORMAL");
  });

  it("barang baru (< 30 hari) yang belum laku belum dinilai, yang sudah laku sedikit tidak dicap lambat", () => {
    expect(nilaiSerap({ ...dasar, masuk: 10, sisa: 10, umurHari: 10 }, 91, true).status).toBe("BELUM_ADA_DATA");
    expect(nilaiSerap({ ...dasar, masuk: 20, laku: 1, sisa: 19, umurHari: 10 }, 91, true).status).toBe("NORMAL");
  });

  it("tanpa laporan laku: belum ada data, tanpa saran", () => {
    const n = nilaiSerap({ ...dasar, masuk: 10, sisa: 10 }, 91, false);
    expect(n).toMatchObject({ status: "BELUM_ADA_DATA", saran: null, hampirHabis: false });
  });

  it("tidak ada barang dan tidak ada laku: belum ada data, persen null", () => {
    expect(nilaiSerap(dasar, 91, true)).toMatchObject({ status: "BELUM_ADA_DATA", persen: null });
  });

  it("cepat dan hampir habis → isi ulang untuk ±30 hari pada lajunya", () => {
    // 30 laku dalam 90 hari aktif = 10 per 30 hari; sisa 2 → saran 8.
    const n = nilaiSerap({ ...dasar, masuk: 32, laku: 30, sisa: 2, umurHari: 200 }, 90, true);
    expect(n).toMatchObject({ status: "CEPAT", hampirHabis: true, saran: "ISI_ULANG", saranQty: 8 });
  });

  it("laju dihitung sejak barang masuk bila lebih pendek dari periode", () => {
    // Masuk 30 hari lalu, laku 9 → 9 per 30 hari; sisa 1 → saran 8.
    const n = nilaiSerap({ ...dasar, masuk: 10, laku: 9, sisa: 1, umurHari: 30 }, 90, true);
    expect(n).toMatchObject({ saran: "ISI_ULANG", saranQty: 8 });
  });

  it("cepat tapi stoknya masih cukup: tidak ada saran", () => {
    const n = nilaiSerap({ ...dasar, masuk: 100, laku: 60, sisa: 40, umurHari: 200 }, 90, true);
    expect(n).toMatchObject({ status: "CEPAT", hampirHabis: false, saran: null });
  });

  it("laku tanpa pernah tercatat masuk tidak melewati 100%", () => {
    expect(nilaiSerap({ ...dasar, laku: 5, sisa: -5 }, 90, true)).toMatchObject({ persen: 100, status: "CEPAT" });
  });

  it("titipan: awal null diturunkan dari sisa + laku − masuk", () => {
    const n = nilaiSerap({ ...dasar, awal: null, masuk: 4, laku: 6, sisa: 3 }, 90, true);
    expect(n.awal).toBe(5);
    expect(n.persen).toBe(67);
  });

  it("barang yang dikembalikan pembeli lebih banyak dari yang laku tidak menghasilkan persen negatif", () => {
    expect(nilaiSerap({ ...dasar, masuk: 10, laku: -1, sisa: 11 }, 90, true).persen).toBe(0);
  });
});

describe("susunPenyerapan", () => {
  const susun = (b: BahanSerap[], adaDataLaku = true, sumber: "BUKU_TOKO" | "TITIPAN" | "TANPA_LAPORAN" = "BUKU_TOKO") =>
    susunPenyerapan({ sumber, adaDataLaku, bahan: b, barang, hariPeriode: 90, hariIni: HARI_INI });

  it("urut tindakan: isi ulang, jangan kirim, cepat, normal, belum ada data", () => {
    const r = susun([
      bahan({ itemId: "kemeja", masuk: 10, laku: 3, sisa: 7 }), // normal
      bahan({ itemId: "topi", masuk: 20, laku: 1, sisa: 19 }), // lambat → jangan kirim
      bahan({ itemId: "celana", masuk: 100, laku: 60, sisa: 40, pertamaMasuk: hariLalu(200) }), // cepat, stok cukup
      bahan({ itemId: "baru", masuk: 5, sisa: 5, pertamaMasuk: hariLalu(3) }), // belum ada data
      bahan({ itemId: "kaos", variantSku: "KAOS-HTM-M", masuk: 12, laku: 11, sisa: 1, pertamaMasuk: hariLalu(200) }), // isi ulang
      bahan({ itemId: "kaos", variantSku: "KAOS-HTM-L", masuk: 12, laku: 3, sisa: 9, pertamaMasuk: hariLalu(200) }),
    ]);
    expect(r.artikel.map((a) => a.itemId)).toEqual(["kaos", "topi", "celana", "kemeja", "baru"]);
    expect(r.ringkas).toMatchObject({ isiUlang: 1, janganKirim: 1, cepat: 2, normal: 1, lambat: 1, belum: 1 });
  });

  it("artikel menjumlah variannya; satu ukuran yang hampir habis cukup untuk saran isi ulang", () => {
    const r = susun([
      bahan({ itemId: "kaos", variantSku: "KAOS-HTM-M", masuk: 12, laku: 11, sisa: 1, pertamaMasuk: hariLalu(200) }),
      bahan({ itemId: "kaos", variantSku: "KAOS-HTM-L", masuk: 12, laku: 3, sisa: 9, pertamaMasuk: hariLalu(200) }),
    ]);
    const kaos = r.artikel[0];
    expect(kaos).toMatchObject({ nama: "Kaos", sku: "KAOS", masuk: 24, laku: 14, sisa: 10, persen: 58, saran: "ISI_ULANG" });
    expect(kaos.varian.map((v) => v.label)).toEqual(["Hitam · M", "Hitam · L"]);
    expect(kaos.varian[0]).toMatchObject({ variantSku: "KAOS-HTM-M", saran: "ISI_ULANG", persen: 92 });
    expect(kaos.saranQty).toBe(kaos.varian[0].saranQty);
    expect(kaos.saranQty).toBeGreaterThan(0);
  });

  it("varian tanpa cerita di periode ini (tidak masuk, tidak laku, tidak ada di rak) tidak ditampilkan", () => {
    const r = susun([bahan({ itemId: "kemeja", awal: 3 }), bahan({ itemId: "topi", masuk: 4, laku: 2, sisa: 2 })]);
    expect(r.artikel.map((a) => a.itemId)).toEqual(["topi"]);
    expect(r.jumlahArtikel).toBe(1);
  });

  it("toko putus tanpa buku: tidak ada yang dikarang, daftar kosong", () => {
    const r = susun([bahan({ itemId: "kemeja", masuk: 10, laku: 3, sisa: 7 })], true, "TANPA_LAPORAN");
    expect(r).toMatchObject({ sumber: "TANPA_LAPORAN", adaDataLaku: false, artikel: [], jumlahArtikel: 0 });
    expect(r.ringkas.persen).toBeNull();
  });

  it("titipan tanpa laporan laku: semua belum ada data, tanpa saran", () => {
    const r = susun([bahan({ itemId: "kemeja", masuk: 10, sisa: 10 })], false, "TITIPAN");
    expect(r.artikel[0]).toMatchObject({ status: "BELUM_ADA_DATA", saran: null });
    expect(r.ringkas.persen).toBeNull();
  });

  it("data kosong", () => {
    const r = susun([]);
    expect(r.artikel).toEqual([]);
    expect(r.ringkas).toMatchObject({ masuk: 0, laku: 0, sisa: 0, persen: null });
  });

  it("ringkasan: terserap keseluruhan", () => {
    const r = susun([bahan({ itemId: "kemeja", masuk: 10, laku: 5, sisa: 5 }), bahan({ itemId: "topi", awal: 10, laku: 2, sisa: 8 })]);
    expect(r.ringkas).toMatchObject({ masuk: 10, laku: 7, sisa: 13, persen: 35 });
  });
});

describe("labelVarianSerap", () => {
  it("warna · ukuran dari daftar varian, SKU bila tidak dikenali, null untuk barang tanpa varian", () => {
    const v = barang.get("kaos")!.variants;
    expect(labelVarianSerap(v, "KAOS-HTM-M", "KAOS")).toBe("Hitam · M");
    expect(labelVarianSerap(null, "XYZ", "KAOS")).toBe("XYZ");
    expect(labelVarianSerap(v, "", "KAOS")).toBeNull();
  });
});

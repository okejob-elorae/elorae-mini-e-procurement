import { describe, it, expect } from "vitest";
import {
  BATAS_PRODUK_KATALOG,
  bungkusTeks,
  hargaTampil,
  labelVarian,
  namaBerkasKartu,
  pilihAwal,
  susunPesanKatalog,
  tautanWaKatalog,
  ukuranTersedia,
} from "./katalog-wa";

describe("hargaTampil", () => {
  it("toko putus: harga tampil hanya kalau salesman memilih menampilkannya", () => {
    expect(hargaTampil("PUTUS", true, 85000)).toBe(85000);
    expect(hargaTampil("PUTUS", false, 85000)).toBeNull();
    expect(hargaTampil("PUTUS", true, null)).toBeNull();
  });

  it("toko konsinyasi: harga TIDAK PERNAH tampil, apa pun pilihannya", () => {
    expect(hargaTampil("KONSI", true, 85000)).toBeNull();
    expect(hargaTampil("KONSI", false, 85000)).toBeNull();
  });
});

describe("labelVarian", () => {
  it("membuang akhiran (SKU) dari label katalog", () => {
    expect(labelVarian("Hitam · XL (KS-01-HTM-XL)", "KS-01-HTM-XL")).toBe("Hitam · XL");
  });

  it("label tanpa akhiran dibiarkan; label kosong jatuh ke SKU", () => {
    expect(labelVarian("KS-01-XL", "KS-01-XL")).toBe("KS-01-XL");
    expect(labelVarian("  ", "KS-01-XL")).toBe("KS-01-XL");
  });
});

describe("ukuranTersedia", () => {
  it("hanya varian yang ada stoknya, urutan dipertahankan, tanpa ganda", () => {
    expect(
      ukuranTersedia([
        { variantSku: "A-S", variantLabel: "S (A-S)", available: 3 },
        { variantSku: "A-M", variantLabel: "M (A-M)", available: 0 },
        { variantSku: "A-L", variantLabel: "L (A-L)", available: 5 },
        { variantSku: "A-L2", variantLabel: "L (A-L2)", available: 1 },
        { variantSku: "A-XL", variantLabel: "XL (A-XL)", available: -2 },
      ]),
    ).toEqual(["S", "L"]);
  });

  it("barang tanpa varian → kosong", () => {
    expect(ukuranTersedia([])).toEqual([]);
  });
});

describe("bungkusTeks", () => {
  // Setiap huruf selebar 1 — cukup untuk menguji pembungkusan tanpa kanvas.
  const ukur = (s: string) => s.length;

  it("membungkus per kata", () => {
    expect(bungkusTeks("Kaos polos lengan pendek", 11, ukur, 3)).toEqual(["Kaos polos", "lengan", "pendek"]);
  });

  it("kelebihan baris dipotong dengan elipsis di baris terakhir", () => {
    expect(bungkusTeks("satu dua tiga empat lima", 9, ukur, 2)).toEqual(["satu dua", "tiga emp…"]);
  });

  it("kata yang lebih lebar dari baris dipecah per huruf", () => {
    expect(bungkusTeks("ABCDEFGHIJ", 4, ukur, 5)).toEqual(["ABCD", "EFGH", "IJ"]);
  });

  it("teks kosong → tanpa baris", () => {
    expect(bungkusTeks("   ", 10, ukur, 2)).toEqual([]);
  });
});

describe("namaBerkasKartu", () => {
  it("urutan dua digit + SKU yang aman untuk nama berkas", () => {
    expect(namaBerkasKartu("KS/01 HTM", 0)).toBe("elorae-01-KS-01-HTM.jpg");
    expect(namaBerkasKartu("ABC", 9)).toBe("elorae-10-ABC.jpg");
  });

  it("SKU kosong tetap menghasilkan nama yang sah", () => {
    expect(namaBerkasKartu("", 2)).toBe("elorae-03-produk.jpg");
  });
});

describe("pilihAwal", () => {
  it("saran dulu, lalu barang baru, tanpa ganda, hanya yang ada di katalog, dibatasi", () => {
    expect(pilihAwal(["a", "b", "x"], ["b", "c", "d"], new Set(["a", "b", "c", "d"]), 3)).toEqual(["a", "b", "c"]);
  });

  it(`bawaan batasnya ${BATAS_PRODUK_KATALOG}`, () => {
    const ids = Array.from({ length: 15 }, (_, i) => `i${i}`);
    expect(pilihAwal(ids, [], new Set(ids))).toHaveLength(BATAS_PRODUK_KATALOG);
  });
});

describe("susunPesanKatalog", () => {
  const dasar = {
    pembuka: "Halo Bu Rina, berikut barang dari Elorae:",
    penutup: "Balas pesan ini untuk memesan.",
    labelUkuran: "Ukuran",
    formatHarga: (n: number) => `Rp ${n.toLocaleString("id-ID")}`,
  };

  it("daftar bernomor dengan nama tebal, SKU, ukuran, dan harga bila ada", () => {
    const pesan = susunPesanKatalog({
      ...dasar,
      produk: [
        { nama: "Kaos Polos", sku: "KS-01", harga: 85000, ukuran: ["S", "M"] },
        { nama: "Kemeja", sku: "KM-02", harga: null, ukuran: [] },
      ],
    });
    expect(pesan).toBe(
      [
        "Halo Bu Rina, berikut barang dari Elorae:",
        "",
        "1. *Kaos Polos* (KS-01)",
        "   Ukuran: S, M",
        "   Rp 85.000",
        "2. *Kemeja* (KM-02)",
        "",
        "Balas pesan ini untuk memesan.",
      ].join("\n"),
    );
  });

  it("catatan salesman disisipkan sebelum penutup; spasi berlebih dibuang", () => {
    const pesan = susunPesanKatalog({
      ...dasar,
      catatan: "  Stok terbatas ya Bu.  ",
      produk: [{ nama: "Kaos", sku: "K", harga: null, ukuran: [] }],
    });
    expect(pesan.split("\n").slice(-3)).toEqual(["Stok terbatas ya Bu.", "", "Balas pesan ini untuk memesan."]);
  });

  it("tanda * di nama barang tidak merusak huruf tebal WhatsApp", () => {
    const pesan = susunPesanKatalog({ ...dasar, produk: [{ nama: "Kaos *Promo*", sku: "K", harga: null, ukuran: [] }] });
    expect(pesan).toContain("1. *Kaos Promo* (K)");
  });
});

describe("tautanWaKatalog", () => {
  it("nomor HP toko → wa.me ke nomor itu dengan pesan terisi", () => {
    expect(tautanWaKatalog("0812-3456-7890", "Halo & salam")).toBe("https://wa.me/6281234567890?text=Halo%20%26%20salam");
  });

  it("telepon rumah atau kosong → wa.me tanpa nomor, salesman memilih sendiri obrolannya", () => {
    expect(tautanWaKatalog("+62 22 4201234", "Halo")).toBe("https://wa.me/?text=Halo");
    expect(tautanWaKatalog(null, "Halo")).toBe("https://wa.me/?text=Halo");
  });
});

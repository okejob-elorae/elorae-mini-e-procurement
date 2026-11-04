import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { CartLine } from "@/lib/field-sales/cart";
import {
  AWALAN_SIMPANAN_KERANJANG_KATALOG,
  UMUR_SIMPANAN_KATALOG_MS,
  bacaSimpananKatalog,
  bacaVarianPack,
  grupPack,
  isiSimpananSama,
  jepitJumlah,
  ketikJumlah,
  kunciSimpananKatalog,
  langkahJumlah,
  petaUkuranPack,
  pulihkanKeranjangKatalog,
  selesaiJumlah,
  susunSimpananKatalog,
  tambahSatuPack,
  tulisSimpananKatalog,
  uraiSimpananKatalog,
  type Penyimpanan,
  type PetaUkuranPack,
  type SimpananKeranjangKatalog,
} from "./keranjang-katalog";

/** sessionStorage tiruan: cukup getItem/setItem/removeItem. */
class SesiTiruan implements Penyimpanan {
  isi = new Map<string, string>();
  getItem(k: string) {
    return this.isi.has(k) ? (this.isi.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.isi.set(k, v);
  }
  removeItem(k: string) {
    this.isi.delete(k);
  }
}

/** Penyimpanan yang dilarang peramban (mode privat): setiap akses melempar. */
const sesiTerlarang: Penyimpanan = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const JAM = 60 * 60 * 1000;
const SEKARANG = Date.UTC(2026, 9, 6, 3, 0, 0);

const baris = (over: Partial<CartLine> = {}): CartLine => ({
  itemId: "item-kaos",
  variantSku: "27000038P-BLK-M",
  variantLabel: "Hitam · M (27000038P-BLK-M)",
  sku: "27000038P",
  nameId: "Kaos Basic",
  unitPrice: 75000,
  available: 10,
  qty: 4,
  requestedUnitPrice: null,
  appealReason: null,
  ...over,
});

describe("jepitJumlah — jumlah yang diketik", () => {
  it("angka di bawah batas dipakai apa adanya", () => {
    expect(jepitJumlah("48", 60)).toEqual({ qty: 48, dijepit: false });
    expect(jepitJumlah("60", 60)).toEqual({ qty: 60, dijepit: false });
  });

  it("di atas batas dijepit ke batas dan ditandai", () => {
    expect(jepitJumlah("48", 30)).toEqual({ qty: 30, dijepit: true });
    expect(jepitJumlah("99999999999999999999999", 12)).toEqual({ qty: 12, dijepit: true });
  });

  it("kosong atau nol = keluar dari keranjang", () => {
    expect(jepitJumlah("", 30)).toEqual({ qty: 0, dijepit: false });
    expect(jepitJumlah("0", 30)).toEqual({ qty: 0, dijepit: false });
    expect(jepitJumlah("000", 30)).toEqual({ qty: 0, dijepit: false });
  });

  it("selain angka dibuang (titik ribuan, spasi, tanda minus)", () => {
    expect(jepitJumlah("007", 30)).toEqual({ qty: 7, dijepit: false });
    expect(jepitJumlah("1.200", 5000)).toEqual({ qty: 1200, dijepit: false });
    expect(jepitJumlah("-5", 30)).toEqual({ qty: 5, dijepit: false });
  });

  it("stok habis atau minus: batasnya nol", () => {
    expect(jepitJumlah("5", 0)).toEqual({ qty: 0, dijepit: true });
    expect(jepitJumlah("5", -3)).toEqual({ qty: 0, dijepit: true });
  });
});

describe("isian jumlah QtyStepper — ketik, tinggalkan, tombol", () => {
  it("mengetik 4 lalu 8 (stok 60): setiap ketikan langsung masuk keranjang", () => {
    expect(ketikJumlah("4", 60, 1)).toEqual({ draf: "4", qty: 4, dijepit: false });
    expect(ketikJumlah("48", 60, 4)).toEqual({ draf: "48", qty: 48, dijepit: false });
  });

  it("mengetik 48 dengan stok 30: tampil 30, keranjang 30, ditandai dijepit", () => {
    expect(ketikJumlah("48", 30, 4)).toEqual({ draf: "30", qty: 30, dijepit: true });
    // Sudah 30 di keranjang: tetap diberi tahu, keranjang tidak diubah lagi.
    expect(ketikJumlah("301", 30, 30)).toEqual({ draf: "30", qty: null, dijepit: true });
  });

  it("pre-order: batas langkah 9999, ketikan lebih dari 6 angka dipotong lalu dijepit", () => {
    expect(ketikJumlah("12345678", 9999, 0)).toEqual({ draf: "9999", qty: 9999, dijepit: true });
  });

  it("kosong atau 0 saat mengetik tidak mengubah keranjang; saat ditinggalkan = keluar dari keranjang", () => {
    expect(ketikJumlah("", 30, 5)).toEqual({ draf: "", qty: null, dijepit: false });
    expect(ketikJumlah("0", 30, 5)).toEqual({ draf: "0", qty: null, dijepit: false });
    expect(selesaiJumlah("", 30, 5)).toBe(0);
    expect(selesaiJumlah("0", 30, 5)).toBe(0);
  });

  it("ditinggalkan tanpa perubahan atau tanpa mengetik: keranjang tidak disentuh", () => {
    expect(selesaiJumlah(null, 30, 5)).toBeNull();
    expect(selesaiJumlah("5", 30, 5)).toBeNull();
    expect(selesaiJumlah("48", 30, 5)).toBe(30);
  });

  it("tombol −/+ dari angka yang tampil, tidak dari jumlah lama di keranjang", () => {
    // Tidak sedang mengetik: dari jumlah keranjang.
    expect(langkahJumlah(1, null, 10, 4)).toBe(5);
    expect(langkahJumlah(-1, null, 10, 4)).toBe(3);
    // Sedang mengetik "" (keranjang masih 5): + mulai dari 0, bukan 6.
    expect(langkahJumlah(1, "", 10, 5)).toBe(1);
    expect(langkahJumlah(-1, "0", 10, 5)).toBe(0);
  });

  it("+ tidak pernah melewati batas; − berhenti di 0", () => {
    expect(langkahJumlah(1, null, 10, 10)).toBe(10);
    expect(langkahJumlah(1, "10", 10, 10)).toBe(10);
    expect(langkahJumlah(-1, null, 10, 0)).toBe(0);
    expect(langkahJumlah(1, null, 0, 0)).toBe(0);
  });
});

describe("isi per pack", () => {
  const rasio = [
    { size: "S", qty: 2 },
    { size: "M", qty: 4 },
    { size: "L", qty: 4 },
    { size: "XL", qty: 2 },
  ];
  const peta: PetaUkuranPack = {
    "27000038P-BLK-S": ["S", ""],
    "27000038P-BLK-M": ["M", ""],
    "27000038P-BLK-L": ["L", ""],
    "27000038P-BLK-XL": ["XL", ""],
  };
  const varian = [
    { variantSku: "27000038P-BLK-L", available: 3 },
    { variantSku: "27000038P-BLK-M", available: 10 },
    { variantSku: "27000038P-BLK-S", available: 10 },
    { variantSku: "27000038P-BLK-XL", available: 10 },
  ];

  it("rasio S2 M4 L4 XL2 dengan stok L hanya 3: L dijepit 3 dan disebut", () => {
    const hasil = tambahSatuPack({ rasio, varian, peta, grup: "", jumlah: {} });
    expect(hasil.baris).toEqual([
      { variantSku: "27000038P-BLK-S", qty: 2 },
      { variantSku: "27000038P-BLK-M", qty: 4 },
      { variantSku: "27000038P-BLK-L", qty: 3 },
      { variantSku: "27000038P-BLK-XL", qty: 2 },
    ]);
    expect(hasil.kurang).toEqual([{ ukuran: "L", butuh: 4, dapat: 3, tidakAda: false }]);
  });

  it("pack kedua menambah di atas isi keranjang; L yang sudah habis tidak bertambah dan tetap disebut", () => {
    const hasil = tambahSatuPack({
      rasio,
      varian,
      peta,
      grup: "",
      jumlah: { "27000038P-BLK-S": 2, "27000038P-BLK-M": 4, "27000038P-BLK-L": 3, "27000038P-BLK-XL": 2 },
    });
    expect(hasil.baris).toEqual([
      { variantSku: "27000038P-BLK-S", qty: 4 },
      { variantSku: "27000038P-BLK-M", qty: 8 },
      { variantSku: "27000038P-BLK-XL", qty: 4 },
    ]);
    expect(hasil.kurang).toEqual([{ ukuran: "L", butuh: 4, dapat: 0, tidakAda: false }]);
  });

  it("ukuran yang tidak ada di barang ini disebut tidak ada; huruf besar-kecil ukuran tidak berpengaruh", () => {
    const hasil = tambahSatuPack({
      rasio: [
        { size: "m", qty: 4 },
        { size: "XXL", qty: 1 },
      ],
      varian,
      peta,
      grup: "",
      jumlah: {},
    });
    expect(hasil.baris).toEqual([{ variantSku: "27000038P-BLK-M", qty: 4 }]);
    expect(hasil.kurang).toEqual([{ ukuran: "XXL", butuh: 1, dapat: 0, tidakAda: true }]);
  });

  it("barang dua warna: pack Hitam hanya mengisi varian hitam", () => {
    const petaDuaWarna: PetaUkuranPack = {
      "K-BLK-M": ["M", "Hitam"],
      "K-BLK-L": ["L", "Hitam"],
      "K-WHT-M": ["M", "Putih"],
      "K-WHT-L": ["L", "Putih"],
    };
    const varianDuaWarna = [
      { variantSku: "K-BLK-L", available: 9 },
      { variantSku: "K-BLK-M", available: 9 },
      { variantSku: "K-WHT-L", available: 9 },
      { variantSku: "K-WHT-M", available: 9 },
    ];
    expect(grupPack(varianDuaWarna, petaDuaWarna)).toEqual(["Hitam", "Putih"]);
    const hasil = tambahSatuPack({
      rasio: [
        { size: "M", qty: 4 },
        { size: "L", qty: 2 },
      ],
      varian: varianDuaWarna,
      peta: petaDuaWarna,
      grup: "Hitam",
      jumlah: {},
    });
    expect(hasil.baris).toEqual([
      { variantSku: "K-BLK-M", qty: 4 },
      { variantSku: "K-BLK-L", qty: 2 },
    ]);
    expect(hasil.kurang).toEqual([]);
    // Warna kedua: varian putih, bukan varian pertama yang ukurannya cocok.
    const putih = tambahSatuPack({
      rasio: [{ size: "M", qty: 4 }],
      varian: varianDuaWarna,
      peta: petaDuaWarna,
      grup: "Putih",
      jumlah: { "K-BLK-M": 4 },
    });
    expect(putih.baris).toEqual([{ variantSku: "K-WHT-M", qty: 4 }]);
  });

  it("tombol pack hanya ada untuk barang yang variannya bertanda ukuran dari rasio", () => {
    expect(grupPack(varian, peta)).toEqual([""]);
    expect(grupPack([{ variantSku: "LAIN-1" }], peta)).toEqual([]);
    expect(grupPack(varian, {})).toEqual([]);
  });

  it("stok minus dibaca nol: jumlah keranjang tidak pernah turun karena pack", () => {
    const hasil = tambahSatuPack({
      rasio: [{ size: "M", qty: 4 }],
      varian: [{ variantSku: "27000038P-BLK-M", available: -2 }],
      peta,
      grup: "",
      jumlah: { "27000038P-BLK-M": 1 },
    });
    expect(hasil.baris).toEqual([]);
    expect(hasil.kurang).toEqual([{ ukuran: "M", butuh: 4, dapat: 0, tidakAda: false }]);
  });
});

describe("ukuran varian dari Item.variants", () => {
  it("membaca teks JSON dengan kunci berhuruf besar, dan warna sebagai grup", () => {
    const mentah = JSON.stringify([
      { Size: "30", sku: "FG-JEANS-001-30" },
      { SKU: "K-BLK-M", Ukuran: " M ", Warna: "Hitam" },
      { sku: "K-WHT-M", size: "M", color: "Putih", barcode: "0127000038PM" },
      { size: "L" },
      { sku: "TANPA-UKURAN", color: "Hitam" },
    ]);
    expect(bacaVarianPack(mentah)).toEqual([
      { variantSku: "FG-JEANS-001-30", ukuran: "30", grup: "" },
      { variantSku: "K-BLK-M", ukuran: "M", grup: "Hitam" },
      { variantSku: "K-WHT-M", ukuran: "M", grup: "Putih" },
    ]);
    expect(bacaVarianPack("bukan json")).toEqual([]);
    expect(bacaVarianPack(null)).toEqual([]);
  });

  it("peta hanya memuat ukuran yang ada di rasio — muatan halaman tetap kecil", () => {
    const peta = petaUkuranPack(
      [
        [
          { sku: "K-BLK-S", size: "S", color: "Hitam" },
          { sku: "K-BLK-XXXL", size: "XXXL", color: "Hitam" },
        ],
        JSON.stringify([{ Size: "30", sku: "FG-JEANS-001-30" }]),
        null,
      ],
      [
        { size: "s", qty: 2 },
        { size: "M", qty: 4 },
      ],
    );
    expect(peta).toEqual({ "K-BLK-S": ["S", "Hitam"] });
    expect(petaUkuranPack([[{ sku: "K-BLK-S", size: "S" }]], [])).toEqual({});
  });
});

describe("simpanan keranjang katalog", () => {
  it("kunci per pengguna dan toko; keranjang pre-order terpisah dari stok siap", () => {
    expect(AWALAN_SIMPANAN_KERANJANG_KATALOG).toBe("elorae.katalog.keranjang.");
    expect(kunciSimpananKatalog("u-1", "toko-1")).toBe("elorae.katalog.keranjang.u-1.toko-1");
    expect(kunciSimpananKatalog("u-1", "toko-1")).not.toBe(kunciSimpananKatalog("u-2", "toko-1"));
    expect(kunciSimpananKatalog("u-1", "toko-1")).not.toBe(kunciSimpananKatalog("u-1", "toko-2"));
    expect(kunciSimpananKatalog("u-1", "toko-1", "jendela-9")).toBe("elorae.katalog.keranjang.u-1.toko-1.inden.jendela-9");
  });

  it("menyimpan baris, catatan, kunci kirim, dan ajuan harga PUTUS", () => {
    const s = susunSimpananKatalog({
      idempotencyKey: "kunci-1",
      baris: [baris(), baris({ variantSku: "", variantLabel: null, itemId: "item-topi", qty: 1, requestedUnitPrice: 60000, appealReason: "Harga toko sebelah" })],
      catatan: "Kirim Senin",
      konsi: false,
      sekarang: SEKARANG,
    });
    expect(s).toEqual({
      idempotencyKey: "kunci-1",
      disimpanPada: SEKARANG,
      catatan: "Kirim Senin",
      baris: [
        { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 },
        { itemId: "item-topi", variantSku: "", qty: 1, requestedUnitPrice: 60000, appealReason: "Harga toko sebelah" },
      ],
    });
  });

  it("KONSI: simpanan di HP tidak membawa harga apa pun", () => {
    const s = susunSimpananKatalog({
      idempotencyKey: "kunci-1",
      baris: [baris({ unitPrice: 0, requestedUnitPrice: 100000, appealReason: "x" })],
      catatan: "",
      konsi: true,
      sekarang: SEKARANG,
    });
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/price|harga|total|Rp/i);
    expect(s?.baris).toEqual([{ itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 }]);
  });

  it("keranjang kosong atau tanpa kunci kirim tidak disimpan", () => {
    expect(susunSimpananKatalog({ idempotencyKey: "k", baris: [], catatan: "x", konsi: false, sekarang: SEKARANG })).toBeNull();
    expect(susunSimpananKatalog({ idempotencyKey: "k", baris: [baris({ qty: 0 })], catatan: "", konsi: false, sekarang: SEKARANG })).toBeNull();
    expect(susunSimpananKatalog({ idempotencyKey: "", baris: [baris()], catatan: "", konsi: false, sekarang: SEKARANG })).toBeNull();
  });

  const contoh = (over: Partial<SimpananKeranjangKatalog> = {}): SimpananKeranjangKatalog => ({
    idempotencyKey: "kunci-awal",
    disimpanPada: SEKARANG,
    catatan: "Kirim Senin",
    baris: [
      { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 },
      { itemId: "item-topi", variantSku: "", qty: 1 },
    ],
    ...over,
  });

  it("bolak-balik simpan → baca utuh, termasuk kunci kirim", () => {
    const sesi = new SesiTiruan();
    const kunci = kunciSimpananKatalog("u-1", "toko-1");
    tulisSimpananKatalog(sesi, kunci, contoh());
    expect(bacaSimpananKatalog(sesi, kunci, SEKARANG + JAM)).toEqual(contoh());
  });

  it("kedaluwarsa sesudah 1 hari dan dibuang dari penyimpanan", () => {
    const sesi = new SesiTiruan();
    const kunci = kunciSimpananKatalog("u-1", "toko-1");
    tulisSimpananKatalog(sesi, kunci, contoh());
    expect(bacaSimpananKatalog(sesi, kunci, SEKARANG + UMUR_SIMPANAN_KATALOG_MS - 1)).not.toBeNull();
    expect(UMUR_SIMPANAN_KATALOG_MS).toBe(24 * JAM);
    expect(bacaSimpananKatalog(sesi, kunci, SEKARANG + UMUR_SIMPANAN_KATALOG_MS + 1)).toBeNull();
    expect(sesi.isi.has(kunci)).toBe(false);
  });

  it("membuka katalog lagi tanpa mengubah keranjang tidak memperpanjang umurnya", () => {
    const sesi = new SesiTiruan();
    const kunci = kunciSimpananKatalog("u-1", "toko-1");
    tulisSimpananKatalog(sesi, kunci, contoh());
    // 23 jam kemudian keranjang dipulihkan; layar menyusun simpanan dari isi yang sama.
    const nanti = SEKARANG + 23 * JAM;
    const dariLayar = susunSimpananKatalog({
      idempotencyKey: "kunci-awal",
      baris: [baris({ qty: 4 }), baris({ itemId: "item-topi", variantSku: "", variantLabel: null, qty: 1 })],
      catatan: "Kirim Senin",
      konsi: false,
      sekarang: nanti,
    });
    expect(isiSimpananSama(bacaSimpananKatalog(sesi, kunci, nanti), dariLayar)).toBe(true);
    // Isi berbeda (jumlah, catatan, kunci kirim) = perubahan: ditulis dengan jam baru.
    expect(isiSimpananSama(contoh(), contoh({ baris: [{ itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 5 }] }))).toBe(false);
    expect(isiSimpananSama(contoh(), contoh({ catatan: "Kirim Selasa" }))).toBe(false);
    expect(isiSimpananSama(contoh(), contoh({ idempotencyKey: "kunci-lain" }))).toBe(false);
    expect(isiSimpananSama(null, contoh())).toBe(false);
    expect(isiSimpananSama(null, null)).toBe(true);
  });

  it("jam HP yang mundur jauh juga dianggap kedaluwarsa (tidak pernah abadi)", () => {
    expect(uraiSimpananKatalog(JSON.stringify(contoh({ disimpanPada: SEKARANG + 2 * 24 * JAM })), SEKARANG)).toBeNull();
  });

  it("simpanan rusak, tanpa kunci, atau tanpa baris sah dianggap tidak ada", () => {
    expect(uraiSimpananKatalog(null, SEKARANG)).toBeNull();
    expect(uraiSimpananKatalog("{rusak", SEKARANG)).toBeNull();
    expect(uraiSimpananKatalog(JSON.stringify({ ...contoh(), idempotencyKey: "" }), SEKARANG)).toBeNull();
    expect(uraiSimpananKatalog(JSON.stringify({ ...contoh(), disimpanPada: "kemarin" }), SEKARANG)).toBeNull();
    expect(
      uraiSimpananKatalog(
        JSON.stringify(contoh({ baris: [{ itemId: "x", variantSku: "", qty: 0 }, { itemId: "y", variantSku: "", qty: 1.5 }] })),
        SEKARANG,
      ),
    ).toBeNull();
  });

  it("baris ganda (barang + varian sama) disatukan, yang rusak dibuang", () => {
    const s = uraiSimpananKatalog(
      JSON.stringify(
        contoh({
          baris: [
            { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 },
            { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 9 },
            { itemId: 7 as unknown as string, variantSku: "", qty: 1 },
          ],
        }),
      ),
      SEKARANG,
    );
    expect(s?.baris).toEqual([{ itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 }]);
  });

  it("penyimpanan dilarang (mode privat): baca null, tulis diam", () => {
    expect(bacaSimpananKatalog(sesiTerlarang, "k", SEKARANG)).toBeNull();
    expect(() => tulisSimpananKatalog(sesiTerlarang, "k", contoh())).not.toThrow();
    expect(() => tulisSimpananKatalog(sesiTerlarang, "k", null)).not.toThrow();
    expect(bacaSimpananKatalog(null, "k", SEKARANG)).toBeNull();
  });

  it("tulis null menghapus simpanan", () => {
    const sesi = new SesiTiruan();
    tulisSimpananKatalog(sesi, "k", contoh());
    tulisSimpananKatalog(sesi, "k", null);
    expect(sesi.isi.size).toBe(0);
  });

  it("pembersih simpanan saat keluar akun mengenal awalan keranjang katalog", () => {
    const sumber = readFileSync(new URL("../pwa/offline/bersihkan.ts", import.meta.url), "utf8");
    expect(sumber).toContain(`"${AWALAN_SIMPANAN_KERANJANG_KATALOG}"`);
  });
});

describe("memulihkan keranjang katalog", () => {
  const katalog = [
    {
      itemId: "item-kaos",
      sku: "27000038P",
      nameId: "Kaos Basic",
      price: 75000,
      available: 13,
      variants: [
        { variantSku: "27000038P-BLK-M", variantLabel: "Hitam · M", available: 3 },
        { variantSku: "27000038P-BLK-L", variantLabel: "Hitam · L", available: 10 },
      ],
    },
    { itemId: "item-topi", sku: "TOPI01", nameId: "Topi", price: 40000, available: 10, variants: [] },
    { itemId: "item-tas", sku: "TAS01", nameId: "Tas", price: null, available: 5, variants: [] },
  ];

  it("jumlah dijepit stok sekarang, barang hilang dilewati, ajuan harga PUTUS ikut", () => {
    const hasil = pulihkanKeranjangKatalog(
      {
        idempotencyKey: "k",
        disimpanPada: SEKARANG,
        catatan: "",
        baris: [
          { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 4 },
          { itemId: "item-topi", variantSku: "", qty: 2, requestedUnitPrice: 35000, appealReason: "Langganan" },
          { itemId: "item-hilang", variantSku: "", qty: 1 },
          { itemId: "item-tas", variantSku: "", qty: 1 },
        ],
      },
      katalog,
      false,
    );
    expect(hasil.baris.map((l) => [l.itemId, l.variantSku, l.qty, l.requestedUnitPrice, l.appealReason])).toEqual([
      ["item-kaos", "27000038P-BLK-M", 3, null, null],
      ["item-topi", "", 2, 35000, "Langganan"],
    ]);
    expect(hasil.baris[0].variantLabel).toBe("Hitam · M");
    expect(hasil.dilewati).toBe(1);
    expect(hasil.tanpaHarga).toEqual(["Tas"]);
  });

  it("KONSI: tanpa harga dan tanpa ajuan", () => {
    const hasil = pulihkanKeranjangKatalog(
      {
        idempotencyKey: "k",
        disimpanPada: SEKARANG,
        catatan: "",
        baris: [{ itemId: "item-topi", variantSku: "", qty: 2, requestedUnitPrice: 35000, appealReason: "x" }],
      },
      katalog.map((k) => ({ ...k, price: null })),
      true,
    );
    expect(hasil.baris).toHaveLength(1);
    expect(hasil.baris[0]).toMatchObject({ unitPrice: 0, requestedUnitPrice: null, appealReason: null, qty: 2 });
  });
});

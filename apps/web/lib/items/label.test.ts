import { describe, expect, it } from "vitest";
import { cocokkanKode, type BarisKatalogKode } from "@/lib/spg/stok";
import {
  alamatLabel,
  bacaOpsiLabel,
  bacaSumberDokumen,
  isiDariDokumen,
  jumlahAwal,
  jumlahSesuaiStok,
  kandidatSkuInduk,
  kodeLabel,
  kunciLabel,
  OPSI_LABEL_BAWAAN,
  periksaLabel,
  rapikanJumlah,
  susunBarisCetak,
  teksVarian,
  totalJumlah,
  type BarangLabel,
} from "./label";

const kaos = (o: Partial<BarangLabel> = {}): BarangLabel => ({
  itemId: "kaos",
  nama: "Kaos Oversize",
  sku: "KAOS-01",
  harga: 129000,
  aktif: true,
  bervarian: true,
  varian: [
    { variantSku: "KAOS-01-HTM-M", ukuran: "M", warna: "Hitam", barcode: "TS000001HTMM", stokGudang: 12 },
    { variantSku: "KAOS-01-HTM-XL", ukuran: "XL", warna: "Hitam", barcode: null, stokGudang: 0 },
    { variantSku: "KAOS-01-PTH-L", ukuran: "L", warna: "Putih", barcode: "  ", stokGudang: -2 },
  ],
  stokTanpaUkuran: 5,
  ...o,
});

const topi = (o: Partial<BarangLabel> = {}): BarangLabel => ({
  itemId: "topi",
  nama: "Topi Polos",
  sku: "TOPI-7",
  harga: null,
  aktif: true,
  bervarian: false,
  varian: [{ variantSku: "", ukuran: null, warna: null, barcode: null, stokGudang: 7.5 }],
  stokTanpaUkuran: 0,
  ...o,
});

describe("kodeLabel — kode di label harus dikenali pemindai SPG", () => {
  it("bawaan: barcode varian, kosong → SKU varian; pilihan SKU: selalu SKU varian; barang tanpa varian: SKU barang", () => {
    const b = kaos();
    expect(kodeLabel(b, b.varian[0], "BARCODE")).toEqual({ kode: "TS000001HTMM", asal: "BARCODE" });
    expect(kodeLabel(b, b.varian[1], "BARCODE")).toEqual({ kode: "KAOS-01-HTM-XL", asal: "SKU_VARIAN" });
    // Barcode berisi spasi saja dianggap kosong.
    expect(kodeLabel(b, b.varian[2], "BARCODE")).toEqual({ kode: "KAOS-01-PTH-L", asal: "SKU_VARIAN" });
    expect(kodeLabel(b, b.varian[0], "SKU")).toEqual({ kode: "KAOS-01-HTM-M", asal: "SKU_VARIAN" });
    const t = topi();
    expect(kodeLabel(t, t.varian[0], "BARCODE")).toEqual({ kode: "TOPI-7", asal: "SKU_BARANG" });
    expect(kodeLabel(t, t.varian[0], "SKU")).toEqual({ kode: "TOPI-7", asal: "SKU_BARANG" });
  });

  it("setiap kode yang dicetak terbaca cocokkanKode ke barang dan varian yang benar", () => {
    const barang = [kaos(), topi()];
    // Katalog layar jual SPG untuk dua barang ini (bentuk getSellableCatalogForSpg).
    const katalog: BarisKatalogKode[] = [
      ...kaos().varian.map((v) => ({ itemId: "kaos", sku: "KAOS-01", variantSku: v.variantSku, barcode: v.barcode?.trim() || null })),
      { itemId: "topi", sku: "TOPI-7", variantSku: null, barcode: null },
    ];
    for (const sumber of ["BARCODE", "SKU"] as const) {
      for (const b of barang) {
        for (const v of b.varian) {
          const { kode } = kodeLabel(b, v, sumber);
          expect(cocokkanKode(kode, katalog), `${sumber} ${kode}`).toEqual({
            jenis: "varian",
            itemId: b.itemId,
            variantSku: b.bervarian ? v.variantSku : null,
          });
        }
      }
    }
  });
});

describe("jumlah label", () => {
  it("rapikanJumlah: bilangan bulat 0–9999, isian tak sah = 0", () => {
    expect(rapikanJumlah("12")).toBe(12);
    expect(rapikanJumlah(" 3 ")).toBe(3);
    expect(rapikanJumlah("2.9")).toBe(2);
    expect(rapikanJumlah("")).toBe(0);
    expect(rapikanJumlah("abc")).toBe(0);
    expect(rapikanJumlah(-4)).toBe(0);
    expect(rapikanJumlah(Number.POSITIVE_INFINITY)).toBe(0);
    expect(rapikanJumlah(123456)).toBe(9999);
    expect(rapikanJumlah(null)).toBe(0);
  });

  it("bawaan satu per varian; sesuai stok gudang memakai stok fisik, stok ≤ 0 → 0, pecahan dibulatkan ke bawah", () => {
    expect(jumlahAwal(kaos())).toEqual({ "kaos::KAOS-01-HTM-M": 1, "kaos::KAOS-01-HTM-XL": 1, "kaos::KAOS-01-PTH-L": 1 });
    expect(jumlahSesuaiStok(kaos())).toEqual({ "kaos::KAOS-01-HTM-M": 12, "kaos::KAOS-01-HTM-XL": 0, "kaos::KAOS-01-PTH-L": 0 });
    expect(jumlahSesuaiStok(topi())).toEqual({ "topi::": 7 });
    expect(totalJumlah([kaos(), topi()], { ...jumlahSesuaiStok(kaos()), ...jumlahSesuaiStok(topi()) })).toBe(19);
  });

  it("susunBarisCetak: urut barang lalu varian, jumlah 0 dilewati, nama/varian/SKU/artikel/ukuran/harga terisi", () => {
    const baris = susunBarisCetak([kaos(), topi()], { "kaos::KAOS-01-HTM-M": 2, "kaos::KAOS-01-HTM-XL": 0, "kaos::KAOS-01-PTH-L": 1, "topi::": 3 }, "BARCODE");
    expect(baris).toEqual([
      { kode: "TS000001HTMM", nama: "Kaos Oversize", varian: "M · Hitam", sku: "KAOS-01-HTM-M", artikel: "KAOS-01", ukuran: "M", harga: 129000, jumlah: 2 },
      { kode: "KAOS-01-PTH-L", nama: "Kaos Oversize", varian: "L · Putih", sku: "KAOS-01-PTH-L", artikel: "KAOS-01", ukuran: "L", harga: 129000, jumlah: 1 },
      { kode: "TOPI-7", nama: "Topi Polos", varian: null, sku: "TOPI-7", artikel: "TOPI-7", ukuran: null, harga: null, jumlah: 3 },
    ]);
  });

  it("teksVarian menggabungkan ukuran dan warna yang diketahui", () => {
    expect(teksVarian({ ukuran: "XL", warna: "Hitam" })).toBe("XL · Hitam");
    expect(teksVarian({ ukuran: "32", warna: null })).toBe("32");
    expect(teksVarian({ ukuran: null, warna: " " })).toBeNull();
  });
});

describe("periksaLabel", () => {
  it("hanya menilai label yang AKAN dicetak", () => {
    const p = periksaLabel([kaos(), topi()], {}, { sumberKode: "BARCODE", ukuran: "50x30", tampilHarga: true });
    expect(p).toEqual({ tanpaBarcode: [], tanpaHarga: [], tidakBisa: [], rapat: [] });
  });

  it("varian tanpa barcode (hanya saat sumber barcode), barang tanpa harga (hanya saat harga tampil)", () => {
    const jumlah = { ...jumlahAwal(kaos()), ...jumlahAwal(topi()) };
    const p = periksaLabel([kaos(), topi()], jumlah, { sumberKode: "BARCODE", ukuran: "50x30", tampilHarga: true });
    expect(p.tanpaBarcode.map((x) => x.variantSku)).toEqual(["KAOS-01-HTM-XL", "KAOS-01-PTH-L"]);
    expect(p.tanpaHarga.map((x) => x.nama)).toEqual(["Topi Polos"]);
    const sku = periksaLabel([kaos(), topi()], jumlah, { sumberKode: "SKU", ukuran: "50x30", tampilHarga: false });
    expect(sku.tanpaBarcode).toEqual([]);
    expect(sku.tanpaHarga).toEqual([]);
  });

  it("kode yang tidak bisa disandikan, dan kode panjang di label kecil", () => {
    const aneh = topi({ itemId: "aneh", nama: "Aneh", sku: "KAOS-É" });
    const panjang = topi({ itemId: "panjang", nama: "Panjang", sku: "SKU-YANG-SANGAT-PANJANG-SEKALI-01" });
    const jumlah = { "aneh::": 1, "panjang::": 1 };
    const kecil = periksaLabel([aneh, panjang], jumlah, { sumberKode: "BARCODE", ukuran: "33x15", tampilHarga: false });
    expect(kecil.tidakBisa.map((x) => x.kode)).toEqual(["KAOS-É"]);
    expect(kecil.rapat.map((x) => x.kode)).toEqual(["SKU-YANG-SANGAT-PANJANG-SEKALI-01"]);
    expect(kecil.rapat[0].lebarModulMm).toBeLessThan(0.2);
    // Kode pendek muat di 50×30 tanpa peringatan rapat.
    expect(periksaLabel([topi()], { "topi::": 1 }, { sumberKode: "BARCODE", ukuran: "50x30", tampilHarga: false }).rapat).toEqual([]);
  });
});

describe("isi dari dokumen kiriman", () => {
  it("bacaSumberDokumen menerima tiga jenis dan menolak sisanya", () => {
    expect(bacaSumberDokumen("pengiriman:cl0abc123")).toEqual({ jenis: "pengiriman", id: "cl0abc123" });
    expect(bacaSumberDokumen(["mutasi:xyz", "konsi:abc"])).toEqual({ jenis: "mutasi", id: "xyz" });
    expect(bacaSumberDokumen("konsi:a_b-c")).toEqual({ jenis: "konsi", id: "a_b-c" });
    for (const salah of [undefined, null, "", "pengiriman", "pengiriman:", "faktur:abc", ":abc", "konsi:a b", "konsi:a/../b", `konsi:${"x".repeat(65)}`]) {
      expect(bacaSumberDokumen(salah), String(salah)).toBeNull();
    }
  });

  it("alamatLabel dari barang atau dokumen", () => {
    expect(alamatLabel({ itemId: "abc" })).toBe("/backoffice/items/labels?item=abc");
    expect(alamatLabel({ jenis: "mutasi", id: "m1" })).toBe("/backoffice/items/labels?dari=mutasi%3Am1");
    expect(bacaSumberDokumen(new URLSearchParams("dari=mutasi%3Am1").get("dari"))).toEqual({ jenis: "mutasi", id: "m1" });
  });

  it("jumlah label = jumlah barang; tanpa ukuran dan yang tak bisa dilabel tidak dibuang diam-diam", () => {
    const hasil = isiDariDokumen(
      [kaos(), topi()],
      [
        { itemId: "kaos", variantSku: "KAOS-01-HTM-M", nama: "Kaos", qty: 4 },
        { itemId: "kaos", variantSku: "kaos-01-htm-m", nama: "Kaos", qty: 2 },
        { itemId: "kaos", variantSku: "", nama: "Kaos", qty: 6 },
        { itemId: "kaos", variantSku: null, nama: "Kaos", qty: 1 },
        { itemId: "kaos", variantSku: "KAOS-01-MRH-S", nama: "Kaos", qty: 3 },
        { itemId: "topi", variantSku: "", nama: "Topi", qty: 5 },
        { itemId: "topi", variantSku: null, nama: "Topi", qty: 0 },
        { itemId: null, variantSku: null, nama: "Gelang diketik", qty: 2 },
        { itemId: "hilang", variantSku: "X-1", nama: "Barang lama", qty: 9 },
      ],
    );
    expect(hasil.jumlah).toEqual({ [kunciLabel("kaos", "KAOS-01-HTM-M")]: 6, [kunciLabel("topi", "")]: 5 });
    expect(hasil.tanpaUkuran).toEqual([{ itemId: "kaos", nama: "Kaos Oversize", qty: 7 }]);
    expect(hasil.dilewati).toEqual([
      { nama: "Kaos Oversize", variantSku: "KAOS-01-MRH-S", qty: 3, alasan: "VARIAN_TIDAK_ADA" },
      { nama: "Gelang diketik", variantSku: null, qty: 2, alasan: "TANPA_BARANG" },
      { nama: "Barang lama", variantSku: "X-1", qty: 9, alasan: "BARANG_TIDAK_ADA" },
    ]);
  });
});

describe("pilihan cetak yang diingat", () => {
  it("simpanan kosong/rusak → bawaan; isian yang tak dikenal kembali ke bawaannya satu per satu", () => {
    expect(bacaOpsiLabel(null)).toEqual(OPSI_LABEL_BAWAAN);
    expect(bacaOpsiLabel("bukan json")).toEqual(OPSI_LABEL_BAWAAN);
    expect(bacaOpsiLabel("[1,2]")).toEqual(OPSI_LABEL_BAWAAN);
    // Pemilik: gaya label yang sudah dipakai, tanpa harga.
    expect(OPSI_LABEL_BAWAAN).toEqual({ gaya: "ELORAE", ukuran: "50x30", tataLetak: "A4", tampilHarga: false, tampilNama: true, sumberKode: "BARCODE" });
    expect(
      bacaOpsiLabel(JSON.stringify({ gaya: "RINCI", ukuran: "33x15", tataLetak: "GULUNGAN", tampilHarga: true, tampilNama: "ya", sumberKode: "QR" })),
    ).toEqual({ gaya: "RINCI", ukuran: "33x15", tataLetak: "GULUNGAN", tampilHarga: true, tampilNama: true, sumberKode: "BARCODE" });
    // Simpanan dari sebelum ada gaya → gaya bawaan.
    expect(bacaOpsiLabel(JSON.stringify({ ukuran: "40x30" })).gaya).toBe("ELORAE");
  });
});

describe("kandidatSkuInduk", () => {
  it("memotong segmen di belakang SKU varian", () => {
    expect(kandidatSkuInduk("KAOS-01-HTM-XL")).toEqual(["KAOS-01-HTM", "KAOS-01", "KAOS"]);
    expect(kandidatSkuInduk("KAOS")).toEqual([]);
  });
});

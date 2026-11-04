import { describe, expect, it } from "vitest";
import {
  alasanBelumKirim,
  barisKurang,
  tersediaUntukBaris,
  untukServer,
  varianBisaDipilih,
  varianOtomatis,
  type BarisKirimIsian,
  type KeadaanVarian,
} from "./kirim-isian";

const bervarian: KeadaanVarian = {
  status: "siap",
  pilihan: {
    perluVarian: true,
    varian: [
      { sku: "B-S", label: "S (B-S)", tersedia: 0 },
      { sku: "B-M", label: "M (B-M)", tersedia: 12 },
    ],
    tersediaTanpaVarian: null,
  },
};
const polos: KeadaanVarian = { status: "siap", pilihan: { perluVarian: false, varian: [], tersediaTanpaVarian: 9 } };

const baris = (over: Partial<BarisKirimIsian> = {}): BarisKirimIsian => ({
  uid: "u",
  itemId: "b1",
  variantSku: null,
  itemName: "Blus",
  qty: 3,
  price: 100_000,
  ...over,
});

describe("alasanBelumKirim", () => {
  it("urut formulir: toko, baris, nama, jumlah, ukuran", () => {
    expect(alasanBelumKirim("", [baris()], { b1: bervarian })).toEqual({ kode: "TOKO" });
    expect(alasanBelumKirim("t", [], {})).toEqual({ kode: "BARIS" });
    expect(alasanBelumKirim("t", [baris({ itemName: " " })], { b1: polos })).toEqual({ kode: "NAMA", baris: 1 });
    expect(alasanBelumKirim("t", [baris({ qty: 0 })], { b1: polos })).toEqual({ kode: "QTY", baris: 1 });
    expect(alasanBelumKirim("t", [baris({ qty: 1.5 })], { b1: polos })).toEqual({ kode: "QTY", baris: 1 });
    expect(alasanBelumKirim("t", [baris({ itemId: "b2" }), baris()], { b1: bervarian, b2: polos })).toEqual({
      kode: "VARIAN",
      baris: 2,
      nama: "Blus",
    });
  });

  it("ukuran yang masih dimuat atau gagal dimuat menahan simpan", () => {
    expect(alasanBelumKirim("t", [baris()], {})).toEqual({ kode: "MEMUAT", baris: 1 });
    expect(alasanBelumKirim("t", [baris()], { b1: { status: "memuat" } })).toEqual({ kode: "MEMUAT", baris: 1 });
    expect(alasanBelumKirim("t", [baris()], { b1: { status: "gagal" } })).toEqual({ kode: "GAGAL_MUAT", baris: 1, nama: "Blus" });
  });

  it("siap: varian dipilih, barang polos, atau baris tanpa katalog", () => {
    expect(alasanBelumKirim("t", [baris({ variantSku: "B-M" })], { b1: bervarian })).toBeNull();
    expect(alasanBelumKirim("t", [baris()], { b1: polos })).toBeNull();
    expect(alasanBelumKirim("t", [baris({ itemId: null, itemName: "Hanger" })], {})).toBeNull();
  });
});

describe("pilihan varian di baris", () => {
  it("hanya varian berstok yang ditawarkan; jumlah yang disembunyikan disebut", () => {
    if (bervarian.status !== "siap") throw new Error();
    expect(varianBisaDipilih(bervarian.pilihan)).toEqual({ tampil: [{ sku: "B-M", label: "M (B-M)", tersedia: 12 }], tersembunyi: 1 });
  });

  it("satu-satunya varian diisikan otomatis; barang bervarian tidak", () => {
    expect(varianOtomatis({ perluVarian: false, varian: [{ sku: "B-M", label: "M", tersedia: 4 }], tersediaTanpaVarian: null })).toBe("B-M");
    if (bervarian.status !== "siap") throw new Error();
    expect(varianOtomatis(bervarian.pilihan)).toBeNull();
  });

  it("stok tersedia per baris mengikuti varian yang dipilih", () => {
    expect(tersediaUntukBaris(baris({ variantSku: "B-M" }), bervarian)).toBe(12);
    expect(tersediaUntukBaris(baris(), bervarian)).toBeNull();
    expect(tersediaUntukBaris(baris(), polos)).toBe(9);
    expect(tersediaUntukBaris(baris({ variantSku: "B-XL" }), bervarian)).toBe(0);
    expect(tersediaUntukBaris(baris({ itemId: null }), polos)).toBeNull();
  });
});

describe("rincian kurang dan muatan server", () => {
  it("baris yang kurang ditandai per barang + varian", () => {
    const kurang = [{ itemId: "b1", variantSku: "B-M", itemName: "Blus", variantLabel: "M (B-M)", requested: 16, available: 12 }];
    expect(barisKurang(baris({ variantSku: "B-M" }), kurang)).toBe(true);
    expect(barisKurang(baris({ variantSku: "B-S" }), kurang)).toBe(false);
    expect(barisKurang(baris({ itemId: null }), kurang)).toBe(false);
  });

  it("uid layar tidak ikut; varian kosong jadi null", () => {
    expect(untukServer([baris({ variantSku: " " }), baris({ variantSku: "B-M", price: Number.NaN })])).toEqual([
      { itemId: "b1", variantSku: null, itemName: "Blus", qty: 3, price: 100_000 },
      { itemId: "b1", variantSku: "B-M", itemName: "Blus", qty: 3, price: 0 },
    ]);
  });
});

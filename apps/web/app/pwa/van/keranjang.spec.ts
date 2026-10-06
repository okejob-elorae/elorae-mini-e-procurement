import { describe, it, expect, vi } from "vitest";
import type { RecordVanSaleActionResult } from "@/app/actions/van-sale";
import type { VanStockRow } from "./VanVariantSheet";
import {
  bacaSimpananKeranjangVan,
  kirimPenjualanVan,
  kirimSekali,
  kunciSesudahUbah,
  kunciSimpananKeranjangVan,
  pulihkanKeranjangVan,
  susunSimpananKeranjangVan,
  tulisSimpananKeranjangVan,
  uraiSimpananKeranjangVan,
  type BarisKeranjangVan,
  type Penyimpanan,
  type SimpananKeranjangVan,
} from "./keranjang";

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

const USER = "user-salesman-1";

const kaosHitamM: VanStockRow = { itemId: "item-kaos", sku: "27000038P", productName: "Kaos Basic", variantSku: "27000038P-BLK-M", variantLabel: "Hitam / M", qtyOnVan: 6, price: 75000 };
const kaosHitamL: VanStockRow = { ...kaosHitamM, variantSku: "27000038P-BLK-L", variantLabel: "Hitam / L", qtyOnVan: 2 };
const topi: VanStockRow = { itemId: "item-topi", sku: "TOPI01", productName: "Topi", variantSku: "", variantLabel: null, qtyOnVan: 10, price: 40000 };
const tasTanpaHarga: VanStockRow = { itemId: "item-tas", sku: "TAS01", productName: "Tas", variantSku: "", variantLabel: null, qtyOnVan: 3, price: null };

const baris = (row: VanStockRow, qty: number): BarisKeranjangVan => ({
  itemId: row.itemId,
  variantSku: row.variantSku,
  sku: row.sku,
  productName: row.productName,
  unitPrice: row.price ?? 0,
  qty,
  qtyOnVan: row.qtyOnVan,
});

const simpananContoh = (over: Partial<SimpananKeranjangVan> = {}): SimpananKeranjangVan => ({
  idempotencyKey: "kunci-awal",
  baris: [
    { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 2 },
    { itemId: "item-topi", variantSku: "", qty: 1 },
  ],
  mode: "adhoc",
  storeId: "",
  uangDiterima: "200000",
  ...over,
});

const tercatat: RecordVanSaleActionResult = { ok: true, saleId: "sale-1", docNo: "VANSALE/2026/10/0007", changeAmount: 10000 };

describe("simpanan keranjang van", () => {
  it("kunci simpanan per pengguna, supaya salesman berikutnya di tab yang sama tidak mewarisi keranjang", () => {
    expect(kunciSimpananKeranjangVan("u-1")).toBe("elorae.van.keranjang.u-1");
    expect(kunciSimpananKeranjangVan("u-1")).not.toBe(kunciSimpananKeranjangVan("u-2"));
  });

  it("keranjang kosong tidak disimpan — kuncinya ikut hilang", () => {
    expect(susunSimpananKeranjangVan({ idempotencyKey: "k", baris: [], mode: "adhoc", storeId: "", uangDiterima: "50000" })).toBeNull();
  });

  it("menyimpan kunci, baris (tanpa harga), cara pembeli, toko, dan uang diterima", () => {
    const s = susunSimpananKeranjangVan({
      idempotencyKey: "k-1",
      baris: [baris(kaosHitamM, 2), baris(topi, 1)],
      mode: "store",
      storeId: "toko-9",
      uangDiterima: "200000",
    });
    expect(s).toEqual({
      idempotencyKey: "k-1",
      baris: [
        { itemId: "item-kaos", variantSku: "27000038P-BLK-M", qty: 2 },
        { itemId: "item-topi", variantSku: "", qty: 1 },
      ],
      mode: "store",
      storeId: "toko-9",
      uangDiterima: "200000",
    });
  });

  it("nama dan HP pembeli langsung TIDAK pernah disimpan di HP", () => {
    const s = susunSimpananKeranjangVan({ idempotencyKey: "k", baris: [baris(topi, 1)], mode: "adhoc", storeId: "", uangDiterima: "" });
    const teks = JSON.stringify(s);
    expect(Object.keys(s ?? {}).sort()).toEqual(["baris", "idempotencyKey", "mode", "storeId", "uangDiterima"]);
    expect(teks).not.toMatch(/nama|phone|hp"/i);
  });

  it("urai: simpanan sah dibaca utuh", () => {
    const s = simpananContoh();
    expect(uraiSimpananKeranjangVan(JSON.stringify(s))).toEqual(s);
  });

  it("urai: rusak, tanpa kunci, atau tanpa baris sah dianggap tidak ada", () => {
    expect(uraiSimpananKeranjangVan(null)).toBeNull();
    expect(uraiSimpananKeranjangVan("{bukan json")).toBeNull();
    expect(uraiSimpananKeranjangVan(JSON.stringify({ ...simpananContoh(), idempotencyKey: "" }))).toBeNull();
    expect(uraiSimpananKeranjangVan(JSON.stringify({ ...simpananContoh(), idempotencyKey: 7 }))).toBeNull();
    expect(uraiSimpananKeranjangVan(JSON.stringify({ ...simpananContoh(), baris: [{ itemId: "x", variantSku: "", qty: 0 }] }))).toBeNull();
  });

  it("urai: baris rusak dibuang, mode/toko/uang yang tidak sah jatuh ke bawaan", () => {
    const mentah = JSON.stringify({
      idempotencyKey: "k-2",
      baris: [
        { itemId: "item-topi", variantSku: "", qty: 3 },
        { itemId: "item-kaos", variantSku: null, qty: 1.5 },
        { itemId: 9, variantSku: "", qty: 1 },
        "sampah",
      ],
      mode: "lain",
      storeId: 12,
      uangDiterima: "12a",
    });
    expect(uraiSimpananKeranjangVan(mentah)).toEqual({
      idempotencyKey: "k-2",
      baris: [{ itemId: "item-topi", variantSku: "", qty: 3 }],
      mode: "adhoc",
      storeId: "",
      uangDiterima: "",
    });
  });
});

describe("pulihkanKeranjangVan — setelah halaman dimuat ulang", () => {
  const stok = [kaosHitamM, kaosHitamL, topi, tasTanpaHarga];

  it("baris dipulihkan dengan harga dan sisa van SEKARANG, jumlah tetap seperti yang dikirim, kunci lama ikut", () => {
    const p = pulihkanKeranjangVan(simpananContoh(), [{ ...kaosHitamM, qtyOnVan: 1, price: 80000 }, topi], []);
    expect(p).not.toBeNull();
    expect(p!.idempotencyKey).toBe("kunci-awal");
    expect(p!.uangDiterima).toBe("200000");
    // Jumlah 2 dipertahankan walau van kini tinggal 1: kalau kiriman pertama sudah
    // tercatat, kirim ulang dengan kunci yang sama mengembalikan penjualan itu.
    expect(p!.baris.get("item-kaos::27000038P-BLK-M")).toEqual({ ...baris(kaosHitamM, 2), qtyOnVan: 1, unitPrice: 80000 });
    expect(p!.baris.get("item-topi::")).toEqual(baris(topi, 1));
  });

  it("barang yang sudah tidak ada di van atau belum berharga dibuang; kunci tetap selama masih ada baris", () => {
    const s = simpananContoh({
      baris: [
        { itemId: "item-kaos", variantSku: "27000038P-BLK-XL", qty: 1 },
        { itemId: "item-tas", variantSku: "", qty: 1 },
        { itemId: "item-topi", variantSku: "", qty: 4 },
      ],
    });
    const p = pulihkanKeranjangVan(s, stok, []);
    expect([...p!.baris.keys()]).toEqual(["item-topi::"]);
    expect(p!.idempotencyKey).toBe("kunci-awal");
  });

  it("semua baris hilang → tidak ada yang dipulihkan (keranjang baru, kunci baru)", () => {
    const s = simpananContoh({ baris: [{ itemId: "item-tas", variantSku: "", qty: 1 }] });
    expect(pulihkanKeranjangVan(s, stok, [])).toBeNull();
    expect(pulihkanKeranjangVan(null, stok, [])).toBeNull();
  });

  it("variantSku null dan \"\" dianggap sama untuk barang tanpa varian", () => {
    const s = simpananContoh({ baris: [{ itemId: "item-topi", variantSku: null, qty: 2 }] });
    expect(pulihkanKeranjangVan(s, stok, [])!.baris.get("item-topi::")?.qty).toBe(2);
  });

  it("toko pembeli hanya dipulihkan bila masih boleh dipilih", () => {
    const s = simpananContoh({ mode: "store", storeId: "toko-9" });
    expect(pulihkanKeranjangVan(s, stok, [{ id: "toko-9" }])!.storeId).toBe("toko-9");
    const tanpaToko = pulihkanKeranjangVan(s, stok, [{ id: "toko-1" }])!;
    expect(tanpaToko.storeId).toBe("");
    expect(tanpaToko.mode).toBe("store");
  });
});

describe("kunciSesudahUbah — satu kunci per keranjang", () => {
  const buat = vi.fn(() => "kunci-baru");

  it("kunci tetap selama keranjang masih berisi (tambah, kurangi, ganti jumlah)", () => {
    expect(kunciSesudahUbah(1, 2, "k", buat)).toBe("k");
    expect(kunciSesudahUbah(3, 1, "k", buat)).toBe("k");
    expect(kunciSesudahUbah(0, 1, "k", buat)).toBe("k");
    expect(buat).not.toHaveBeenCalled();
  });

  it("keranjang dikosongkan → kunci baru, supaya keranjang berikutnya bukan 'kirim ulang' penjualan lama", () => {
    expect(kunciSesudahUbah(2, 0, "k", buat)).toBe("kunci-baru");
    expect(buat).toHaveBeenCalledTimes(1);
  });
});

describe("kirimSekali — membedakan ditolak dari terputus", () => {
  it("ok → tercatat", async () => {
    expect(await kirimSekali(async () => tercatat)).toEqual({ jenis: "tercatat", saleId: "sale-1", docNo: "VANSALE/2026/10/0007" });
  });

  it("jawaban penolakan server → ditolak, membawa alasannya", async () => {
    const tolak: RecordVanSaleActionResult = { ok: false, reason: "INSUFFICIENT_VAN_STOCK", shortLines: [{ itemId: "item-topi", variantSku: "", requested: 11, available: 10 }] };
    expect(await kirimSekali(async () => tolak)).toEqual({ jenis: "ditolak", hasil: tolak });
  });

  it("sinyal putus (janji ditolak) → terputus, tidak melempar ke layar galat", async () => {
    expect(await kirimSekali(() => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ jenis: "terputus" });
  });

  it("server tidak menjawab dalam batas waktu → terputus", async () => {
    const hasil = await kirimSekali(() => new Promise<RecordVanSaleActionResult>(() => {}), 20);
    expect(hasil).toEqual({ jenis: "terputus" });
  });
});

describe("kirimPenjualanVan — kunci disimpan sampai penjualan tercatat", () => {
  it("kunci tetap ada setelah galat; kirim ulang memakai kunci yang SAMA; terhapus setelah berhasil", async () => {
    const sesi = new SesiTiruan();
    const simpanan = simpananContoh({ idempotencyKey: "kunci-K1" });
    const kunciDikirim: string[] = [];

    const pertama = await kirimPenjualanVan({
      penyimpanan: sesi,
      userId: USER,
      simpanan,
      kirim: async (k) => {
        kunciDikirim.push(k);
        throw new TypeError("Failed to fetch");
      },
    });
    expect(pertama).toEqual({ jenis: "terputus" });
    expect(bacaSimpananKeranjangVan(sesi, USER)?.idempotencyKey).toBe("kunci-K1");

    // Halaman dimuat ulang: keranjang dan kuncinya dibaca lagi dari sesi.
    const dipulihkan = bacaSimpananKeranjangVan(sesi, USER)!;
    const kedua = await kirimPenjualanVan({
      penyimpanan: sesi,
      userId: USER,
      simpanan: dipulihkan,
      kirim: async (k) => {
        kunciDikirim.push(k);
        return tercatat;
      },
    });
    expect(kedua).toEqual({ jenis: "tercatat", saleId: "sale-1", docNo: "VANSALE/2026/10/0007" });
    expect(kunciDikirim).toEqual(["kunci-K1", "kunci-K1"]);
    expect(bacaSimpananKeranjangVan(sesi, USER)).toBeNull();
    expect(sesi.isi.size).toBe(0);
  });

  it("kunci sudah tersimpan SEBELUM kiriman berangkat (muat ulang di tengah kiriman tidak kehilangannya)", async () => {
    const sesi = new SesiTiruan();
    let terbacaSaatKirim: string | undefined;
    await kirimPenjualanVan({
      penyimpanan: sesi,
      userId: USER,
      simpanan: simpananContoh({ idempotencyKey: "kunci-K2" }),
      kirim: async () => {
        terbacaSaatKirim = bacaSimpananKeranjangVan(sesi, USER)?.idempotencyKey;
        return new Promise<RecordVanSaleActionResult>(() => {});
      },
      batasMs: 10,
    });
    expect(terbacaSaatKirim).toBe("kunci-K2");
    expect(bacaSimpananKeranjangVan(sesi, USER)?.idempotencyKey).toBe("kunci-K2");
  });

  it("penolakan server (stok van kurang) tidak menghapus kunci", async () => {
    const sesi = new SesiTiruan();
    const hasil = await kirimPenjualanVan({
      penyimpanan: sesi,
      userId: USER,
      simpanan: simpananContoh({ idempotencyKey: "kunci-K3" }),
      kirim: async () => ({ ok: false, reason: "INSUFFICIENT_PAYMENT" }),
    });
    expect(hasil.jenis).toBe("ditolak");
    expect(bacaSimpananKeranjangVan(sesi, USER)?.idempotencyKey).toBe("kunci-K3");
  });

  it("berhasil hanya menghapus keranjang pengguna ini", async () => {
    const sesi = new SesiTiruan();
    tulisSimpananKeranjangVan(sesi, "user-lain", simpananContoh({ idempotencyKey: "milik-orang-lain" }));
    await kirimPenjualanVan({ penyimpanan: sesi, userId: USER, simpanan: simpananContoh(), kirim: async () => tercatat });
    expect(bacaSimpananKeranjangVan(sesi, "user-lain")?.idempotencyKey).toBe("milik-orang-lain");
    expect(bacaSimpananKeranjangVan(sesi, USER)).toBeNull();
  });

  it("penyimpanan dilarang (mode privat): penjualan tetap terkirim, tidak melempar", async () => {
    const kirim = vi.fn(async () => tercatat);
    const hasil = await kirimPenjualanVan({ penyimpanan: sesiTerlarang, userId: USER, simpanan: simpananContoh({ idempotencyKey: "kunci-K4" }), kirim });
    expect(hasil.jenis).toBe("tercatat");
    expect(kirim).toHaveBeenCalledWith("kunci-K4");
    expect(bacaSimpananKeranjangVan(sesiTerlarang, USER)).toBeNull();
    expect(() => tulisSimpananKeranjangVan(null, USER, simpananContoh())).not.toThrow();
  });
});

describe("keluar akun", () => {
  it("pembersih simpanan saat keluar mengenal awalan keranjang van", async () => {
    const { readFileSync } = await import("node:fs");
    const { AWALAN_SIMPANAN_KERANJANG_VAN } = await import("./keranjang");
    const sumber = readFileSync(new URL("../../../lib/pwa/offline/bersihkan.ts", import.meta.url), "utf8");
    expect(sumber).toContain(`"${AWALAN_SIMPANAN_KERANJANG_VAN}"`);
  });
});

import { describe, expect, it } from "vitest";
import {
  INFO_POTONG_PEMASOK,
  SEMUA_JENIS_POTONG_PEMASOK,
  bacaJenisPotongPemasok,
  bacaSkbPemasok,
  hitungPotongPemasok,
  keadaanSkb,
  skbBerlaku,
  teksDibebaskanSkb,
  tentukanPotongPemasok,
} from "./pemotongan";

describe("Supplier.taxWithholding — jenis potongan pemasok", () => {
  it("tiga jenis, masing-masing berperan hutang pajaknya sendiri", () => {
    expect(SEMUA_JENIS_POTONG_PEMASOK).toEqual(["PPH23", "PPH21", "PPH4_2"]);
    expect(INFO_POTONG_PEMASOK.PPH23.peranHutang).toBe("PPH23_PAYABLE");
    expect(INFO_POTONG_PEMASOK.PPH21.peranHutang).toBe("PPH21_PAYABLE");
    expect(INFO_POTONG_PEMASOK.PPH4_2.peranHutang).toBe("PPH4_2_PAYABLE");
    expect(bacaJenisPotongPemasok("PPH23")).toBe("PPH23");
    expect(bacaJenisPotongPemasok(null)).toBeNull();
    expect(bacaJenisPotongPemasok("pph23")).toBeNull();
  });
});

describe("hitungPotongPemasok", () => {
  it("PPh 23 jasa maklon badan: 2%, 4% tanpa NPWP", () => {
    expect(hitungPotongPemasok(10_000_000, "PPH23", { adaNpwp: true })).toMatchObject({ pph: 200_000, neto: 9_800_000 });
    expect(hitungPotongPemasok(10_000_000, "PPH23", { adaNpwp: false })).toMatchObject({ pph: 400_000, neto: 9_600_000 });
  });

  it("PPh 21 penjahit orang pribadi: 50% × bruto × 5% pada lapisan pertama", () => {
    // DPP 5 jt × 5% = 250.000.
    expect(hitungPotongPemasok(10_000_000, "PPH21", { adaNpwp: true })).toMatchObject({ pph: 250_000, neto: 9_750_000 });
    expect(hitungPotongPemasok(10_000_000, "PPH21", { adaNpwp: false })).toMatchObject({ pph: 300_000 });
  });

  it("PPh 4(2) sewa 10%, dibulatkan ke bawah ke rupiah penuh", () => {
    expect(hitungPotongPemasok(25_000_000, "PPH4_2", { adaNpwp: true })).toMatchObject({ pph: 2_500_000, neto: 22_500_000, tarifEfektifPersen: 10 });
    expect(hitungPotongPemasok(1_234_567, "PPH4_2", { adaNpwp: true })).toMatchObject({ pph: 123_456, neto: 1_111_111 });
  });

  it("tidak dipotong / nol / tidak sah → PPh 0", () => {
    expect(hitungPotongPemasok(5_000_000, null, { adaNpwp: true })).toEqual({ jenis: null, bruto: 5_000_000, pph: 0, neto: 5_000_000, tarifEfektifPersen: 0 });
    expect(hitungPotongPemasok(0, "PPH23", { adaNpwp: true }).pph).toBe(0);
    expect(hitungPotongPemasok(Number.NaN, "PPH23", { adaNpwp: true })).toMatchObject({ bruto: 0, pph: 0, neto: 0 });
  });
});

describe("SKB pemasok — satu penentu potongan untuk semua jalur", () => {
  const SKB = { nomor: "KET-00123/SKB/WPJ.04/2026", berlakuSampai: "2026-12-31" };

  it("SKB berlaku sampai hari bayar (inklusif, hari WIB) → tidak dipotong apa pun jenisnya; dicatat dibebaskan", () => {
    for (const jenis of SEMUA_JENIS_POTONG_PEMASOK) {
      const k = tentukanPotongPemasok({ jenis, skb: SKB, tanggal: "2026-12-31" });
      expect(k.jenis).toBeNull();
      expect(k.dibebaskanSkb).toEqual({ nomor: SKB.nomor, berlakuSampai: "2026-12-31", jenis, keterangan: `Dibebaskan SKB ${SKB.nomor}` });
      expect(k.skbHabis).toBeNull();
    }
    expect(tentukanPotongPemasok({ jenis: "PPH21", skb: SKB, tanggal: "2026-01-15" }).jenis).toBeNull();
  });

  it("SKB kedaluwarsa (berlaku sampai SEBELUM hari bayar) → potongan normal jenisnya, ditandai habis", () => {
    const k = tentukanPotongPemasok({ jenis: "PPH21", skb: SKB, tanggal: "2027-01-01" });
    expect(k).toEqual({ jenis: "PPH21", dibebaskanSkb: null, skbHabis: { nomor: SKB.nomor, berlakuSampai: "2026-12-31" } });
    // PPh 21 penjahit perorangan tanpa SKB: 50% × 5% = 2,5% pada lapisan pertama.
    expect(hitungPotongPemasok(1_000_000, k.jenis, { adaNpwp: true }).pph).toBe(25_000);
  });

  it("tanpa SKB, SKB tanpa tanggal, atau nomor kosong → jenis apa adanya", () => {
    expect(tentukanPotongPemasok({ jenis: "PPH23", skb: null, tanggal: "2026-05-01" })).toEqual({ jenis: "PPH23", dibebaskanSkb: null, skbHabis: null });
    expect(tentukanPotongPemasok({ jenis: "PPH23", skb: { nomor: "X", berlakuSampai: null }, tanggal: "2026-05-01" }).jenis).toBe("PPH23");
    expect(tentukanPotongPemasok({ jenis: "PPH23", skb: { nomor: "  ", berlakuSampai: "2030-01-01" }, tanggal: "2026-05-01" }).jenis).toBe("PPH23");
  });

  it("pemasok yang memang tidak dipotong: tidak ada yang dibebaskan, tidak ada peringatan", () => {
    expect(tentukanPotongPemasok({ jenis: null, skb: SKB, tanggal: "2026-05-01" })).toEqual({ jenis: null, dibebaskanSkb: null, skbHabis: null });
    expect(tentukanPotongPemasok({ jenis: null, skb: SKB, tanggal: "2027-05-01" })).toEqual({ jenis: null, dibebaskanSkb: null, skbHabis: null });
  });

  it("tanggal bayar tidak sah tidak pernah membebaskan", () => {
    expect(tentukanPotongPemasok({ jenis: "PPH23", skb: SKB, tanggal: "31-12-2026" }).jenis).toBe("PPH23");
    expect(skbBerlaku(SKB, "")).toBe(false);
  });

  it("baris Supplier → SKB: tanggal berlaku dibaca sebagai hari WIB, bukan UTC", () => {
    // 2026-12-31 00:00 WIB tersimpan sebagai 2026-12-30T17:00Z.
    expect(bacaSkbPemasok({ skbNumber: " SKB-1 ", skbValidUntil: new Date("2026-12-30T17:00:00.000Z") })).toEqual({ nomor: "SKB-1", berlakuSampai: "2026-12-31" });
    expect(bacaSkbPemasok({ skbNumber: null, skbValidUntil: null })).toBeNull();
    expect(bacaSkbPemasok({ skbNumber: "", skbValidUntil: new Date() })).toBeNull();
    expect(teksDibebaskanSkb("SKB-1")).toBe("Dibebaskan SKB SKB-1");
  });
});

describe("keadaanSkb — label daftar master pemasok", () => {
  it("berlaku s/d tanggal (termasuk hari terakhirnya) atau habis; tanpa SKB lengkap → null", () => {
    expect(keadaanSkb({ nomor: "SKB-1", berlakuSampai: "2026-12-31" }, "2026-12-31")).toEqual({ nomor: "SKB-1", berlakuSampai: "2026-12-31", habis: false });
    expect(keadaanSkb({ nomor: "SKB-1", berlakuSampai: "2026-12-31" }, "2027-01-01")).toEqual({ nomor: "SKB-1", berlakuSampai: "2026-12-31", habis: true });
    expect(keadaanSkb({ nomor: "SKB-1", berlakuSampai: null }, "2027-01-01")).toBeNull();
    expect(keadaanSkb(null, "2027-01-01")).toBeNull();
  });
});

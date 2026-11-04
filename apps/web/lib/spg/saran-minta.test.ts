import { describe, expect, it } from "vitest";
import {
  alamatMinta,
  bacaAlasan,
  bacaTambahan,
  BATAS_TAMBAHAN,
  susunSaranMinta,
  tulisTambahan,
  type BahanSaranMinta,
  type BarisTambahan,
} from "./saran-minta";

const HARI = 86_400_000;
const hariIni = new Date("2026-10-01T05:00:00Z");
const lalu = (n: number) => new Date(hariIni.getTime() - n * HARI);
const lama = new Date("2024-01-01T00:00:00Z");

describe("bacaAlasan", () => {
  it("accepts exactly the five reasons", () => {
    for (const a of ["LAKU_DI_TOKO_LAIN", "SERING_DIKIRIM", "BARANG_BARU", "LAKU_DI_SINI", "MANUAL"]) expect(bacaAlasan(a)).toBe(a);
    expect(bacaAlasan("manual")).toBeNull();
    expect(bacaAlasan("DICARI")).toBeNull();
    expect(bacaAlasan(undefined)).toBeNull();
  });
});

describe("tulisTambahan / bacaTambahan", () => {
  it("round-trips lines, including SKUs with separators in them", () => {
    const baris: BarisTambahan[] = [
      { itemId: "cm1abc", variantSku: "KAOS-HTM~XL,2", qty: 3, alasan: "LAKU_DI_SINI" },
      { itemId: "cm2def", variantSku: "", qty: 12, alasan: "SERING_DIKIRIM" },
    ];
    expect(bacaTambahan(tulisTambahan(baris))).toEqual(baris);
    // Lewat URL sungguhan.
    const url = new URL(alamatMinta(baris), "http://x.invalid");
    expect(url.pathname).toBe("/pwa/spg/stok/minta");
    expect(bacaTambahan(url.searchParams.get("tambah"))).toEqual(baris);
  });

  it("drops malformed parts, not the whole address, and merges duplicates", () => {
    const raw = [
      "LAKU_DI_SINI~i1~M~2",
      "LAKU_DI_SINI~i1~M~3",
      "PALSU~i2~~1",
      "MANUAL~../x~~1",
      "MANUAL~i3~~0",
      "MANUAL~i4~~1.5",
      "MANUAL~i5~~999999",
      "MANUAL~i6~~",
      "MANUAL~i7",
      "BARANG_BARU~i8~~4",
    ].join(",");
    expect(bacaTambahan(raw)).toEqual([
      { itemId: "i1", variantSku: "M", qty: 5, alasan: "LAKU_DI_SINI" },
      { itemId: "i8", variantSku: "", qty: 4, alasan: "BARANG_BARU" },
    ]);
    expect(bacaTambahan(undefined)).toEqual([]);
    expect(bacaTambahan(["MANUAL~i1~~1"])).toEqual([{ itemId: "i1", variantSku: "", qty: 1, alasan: "MANUAL" }]);
    expect(bacaTambahan("%E0%A4%A~i1~~1")).toEqual([]);
  });

  it("caps the number of lines one address can carry", () => {
    const banyak = Array.from({ length: BATAS_TAMBAHAN + 10 }, (_, i) => `MANUAL~i${i}~~1`).join(",");
    expect(bacaTambahan(banyak)).toHaveLength(BATAS_TAMBAHAN);
  });
});

describe("susunSaranMinta", () => {
  const bahan = (ubah: Partial<BahanSaranMinta> = {}): BahanSaranMinta => ({
    jualSejenis: [
      { itemId: "P1", pcs: 20, toko: 3 },
      { itemId: "P2", pcs: 50, toko: 4 }, // gudang habis
      { itemId: "P3", pcs: 4, toko: 1 }, // terlalu sedikit untuk disebut laku
      { itemId: "P4", pcs: 9, toko: 2 }, // masih banyak di rak toko ini
      { itemId: "S1", pcs: 30, toko: 2 }, // juga sering dikirim → satu alasan saja
    ],
    kiriman: [
      { itemId: "S1", tanggal: lalu(20), pcs: 12 },
      { itemId: "S1", tanggal: lalu(60), pcs: 12 },
      { itemId: "S1", tanggal: lalu(100), pcs: 12 },
      { itemId: "S2", tanggal: lalu(30), pcs: 6 },
      { itemId: "S2", tanggal: lalu(50), pcs: 6 },
      { itemId: "S3", tanggal: lalu(10), pcs: 6 }, // sekali saja
      { itemId: "S4", tanggal: lalu(300), pcs: 6 }, // di luar jendela
      { itemId: "S4", tanggal: lalu(400), pcs: 6 },
      { itemId: "N2", tanggal: lalu(3), pcs: 2 }, // barang baru yang sudah pernah dikirim
    ],
    saldo: new Map([
      ["S1", 2],
      ["S2", 5],
      ["P1", 0],
      ["P4", 9],
    ]),
    pernahDiBuku: new Set(["S1", "S2", "P1", "P4", "N4"]),
    barang: [
      { itemId: "P1", tersedia: 10, dibuat: lama },
      { itemId: "P2", tersedia: 0, dibuat: lama },
      { itemId: "P3", tersedia: 5, dibuat: lama },
      { itemId: "P4", tersedia: 5, dibuat: lama },
      { itemId: "S1", tersedia: 8, dibuat: lama },
      { itemId: "S2", tersedia: 8, dibuat: lama },
      { itemId: "S3", tersedia: 8, dibuat: lama },
      { itemId: "S4", tersedia: 8, dibuat: lama },
      { itemId: "N1", tersedia: 3, dibuat: lalu(10) },
      { itemId: "N2", tersedia: 3, dibuat: lalu(5) },
      { itemId: "N3", tersedia: 0, dibuat: lalu(5) },
      { itemId: "N4", tersedia: 3, dibuat: lalu(5) },
    ],
    hariBaru: 90,
    ...ubah,
  });

  it("builds three groups, one product one reason, only products the warehouse can send", () => {
    const s = susunSaranMinta(bahan(), hariIni);
    expect(s.SERING_DIKIRIM).toEqual([{ alasan: "SERING_DIKIRIM", itemId: "S1", kali: 3, pcs: 36, sisa: 2, hariSejak: 20 }]);
    expect(s.LAKU_DI_TOKO_LAIN).toEqual([{ alasan: "LAKU_DI_TOKO_LAIN", itemId: "P1", pcs: 20, toko: 3, sisa: 0 }]);
    expect(s.BARANG_BARU).toEqual([{ alasan: "BARANG_BARU", itemId: "N1", umurHari: 10 }]);
  });

  it("calls stock thin relative to the usual shipment, not only at 2 pieces", () => {
    // S1 dikirim rata-rata 12: sisa 3 (= seperempatnya) masih tipis; sisa 4 tidak.
    const saldo = (s1: number) => new Map([["S1", s1], ["S2", 5]]);
    expect(susunSaranMinta(bahan({ saldo: saldo(3) }), hariIni).SERING_DIKIRIM.map((x) => x.itemId)).toEqual(["S1"]);
    expect(susunSaranMinta(bahan({ saldo: saldo(4) }), hariIni).SERING_DIKIRIM).toEqual([]);
  });

  it("never suggests a product the warehouse cannot send", () => {
    const s = susunSaranMinta(
      bahan({ barang: bahan().barang.map((b) => ({ ...b, tersedia: 0 })) }),
      hariIni,
    );
    expect([s.SERING_DIKIRIM, s.LAKU_DI_TOKO_LAIN, s.BARANG_BARU]).toEqual([[], [], []]);
  });

  it("without a stock book: frequent products still show (stock unknown), elsewhere-sellers only if never sent here", () => {
    const s = susunSaranMinta(bahan({ saldo: null }), hariIni);
    expect(s.SERING_DIKIRIM.map((x) => [x.itemId, x.alasan === "SERING_DIKIRIM" ? x.sisa : "-"])).toEqual([
      ["S1", null],
      ["S2", null],
    ]);
    expect(s.LAKU_DI_TOKO_LAIN.map((x) => x.itemId)).toEqual(["P1", "P4"]);
  });
});

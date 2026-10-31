import { describe, expect, it } from "vitest";
import { jumlahPenjualan, penjualanKosong, periksaPenjualan, sumberSah } from "./penjualan-aturan";

describe("periksaPenjualan", () => {
  const tgl = new Date("2026-10-01T17:00:00.000Z");

  it("baris baru wajib bertanggal", () => {
    expect(periksaPenjualan({ baru: true, orders: 1, gmv: 100 })).toBe("TANGGAL_WAJIB");
    expect(periksaPenjualan({ baru: true, date: new Date("x"), orders: 1 })).toBe("TANGGAL_WAJIB");
    expect(periksaPenjualan({ baru: true, date: tgl, orders: 1, gmv: 100, commission: 10, source: "Shopee" })).toBeNull();
  });

  it("menolak angka negatif, order pecahan, dan sumber yang tidak dikenal", () => {
    expect(periksaPenjualan({ baru: true, date: tgl, orders: 1.5 })).toBe("ANGKA_TIDAK_SAH");
    expect(periksaPenjualan({ baru: true, date: tgl, gmv: -1 })).toBe("ANGKA_TIDAK_SAH");
    expect(periksaPenjualan({ baru: true, date: tgl, commission: Number.NaN })).toBe("ANGKA_TIDAK_SAH");
    expect(periksaPenjualan({ baru: true, date: tgl, source: "Tokopedia" })).toBe("SUMBER_TIDAK_SAH");
  });

  it("saat mengubah, kolom yang tidak dikirim tidak diperiksa", () => {
    expect(periksaPenjualan({ baru: false, note: "koreksi" })).toBeNull();
  });

  it("baris tanpa order dan tanpa GMV dianggap kosong", () => {
    expect(penjualanKosong(0, 0)).toBe(true);
    expect(penjualanKosong(0, 0.001)).toBe(true);
    expect(penjualanKosong(1, 0)).toBe(false);
    expect(penjualanKosong(0, 1500)).toBe(false);
  });

  it("mengenali tiga sumber", () => {
    expect(["TikTok Shop", "Shopee", "Lainnya"].every(sumberSah)).toBe(true);
    expect(sumberSah("tiktok")).toBe(false);
  });
});

describe("jumlahPenjualan", () => {
  it("menjumlah dalam sen — tidak ada 0,30000000000000004", () => {
    expect(
      jumlahPenjualan([
        { orders: 1, gmv: 0.1, commission: 0.1 },
        { orders: 2, gmv: 0.2, commission: 0.2 },
      ]),
    ).toEqual({ orders: 3, gmv: 0.3, komisi: 0.3 });
    expect(jumlahPenjualan([])).toEqual({ orders: 0, gmv: 0, komisi: 0 });
  });
});

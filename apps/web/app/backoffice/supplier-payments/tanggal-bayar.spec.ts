import { describe, expect, it } from "vitest";
import { tanggalBayarDariIsian, tanggalBayarSah } from "./tanggal-bayar";

/*
 * Tanda lunas PO sekarang dikonfirmasi dengan tanggal bayar. Jurnal pembayaran
 * diberi tanggal itu, jadi tanggal sesudah hari ini (WIB) ditolak.
 */
const SEKARANG = new Date("2026-10-06T05:00:00.000Z"); // 6 Okt 2026, 12.00 WIB

describe("tanggalBayarSah", () => {
  it("hari ini dan kemarin sah", () => {
    expect(tanggalBayarSah(SEKARANG, SEKARANG)).toBe(true);
    expect(tanggalBayarSah(new Date("2026-10-05T00:00:00+07:00"), SEKARANG)).toBe(true);
  });

  it("akhir hari ini WIB masih sah, besok tidak", () => {
    expect(tanggalBayarSah(new Date("2026-10-06T23:59:59+07:00"), SEKARANG)).toBe(true);
    expect(tanggalBayarSah(new Date("2026-10-07T00:00:00+07:00"), SEKARANG)).toBe(false);
  });

  it("tanggal rusak tidak sah", () => {
    expect(tanggalBayarSah(new Date("x"), SEKARANG)).toBe(false);
  });
});

describe("tanggalBayarDariIsian", () => {
  it("hari ini → waktu sekarang (jam ikut tercatat)", () => {
    expect(tanggalBayarDariIsian("2026-10-06", SEKARANG)).toEqual(SEKARANG);
  });

  it("tanggal lampau → awal hari itu (WIB)", () => {
    expect(tanggalBayarDariIsian("2026-10-01", SEKARANG)?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("besok atau isian rusak/kosong → null", () => {
    expect(tanggalBayarDariIsian("2026-10-07", SEKARANG)).toBeNull();
    expect(tanggalBayarDariIsian("", SEKARANG)).toBeNull();
    expect(tanggalBayarDariIsian("bukan-tanggal", SEKARANG)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  ATURAN_CHECKIN_BAWAAN,
  ATURAN_HASIL_BAWAAN,
  bacaAturanCheckin,
  bacaAturanHasilKunjungan,
  tulisAturanCheckin,
  tulisAturanHasilKunjungan,
  sahRadiusGlobal,
} from "./aturan-kunjungan";

describe("bacaAturanHasilKunjungan", () => {
  it("bawaan: alasan wajib, foto tidak wajib", () => {
    expect(ATURAN_HASIL_BAWAAN).toEqual({ alasanWajib: true, fotoWajib: false });
    expect(bacaAturanHasilKunjungan(null)).toEqual(ATURAN_HASIL_BAWAAN);
    expect(bacaAturanHasilKunjungan(undefined)).toEqual(ATURAN_HASIL_BAWAAN);
    expect(bacaAturanHasilKunjungan("")).toEqual(ATURAN_HASIL_BAWAAN);
  });

  it("JSON rusak atau bukan objek → bawaan, tidak melempar", () => {
    expect(bacaAturanHasilKunjungan("{bukan json")).toEqual(ATURAN_HASIL_BAWAAN);
    expect(bacaAturanHasilKunjungan("[]")).toEqual(ATURAN_HASIL_BAWAAN);
    expect(bacaAturanHasilKunjungan("true")).toEqual(ATURAN_HASIL_BAWAAN);
  });

  it("nilai sah dipakai, yang tidak sah diganti bawaan per kolom", () => {
    expect(bacaAturanHasilKunjungan(JSON.stringify({ alasanWajib: false, fotoWajib: true }))).toEqual({
      alasanWajib: false,
      fotoWajib: true,
    });
    expect(bacaAturanHasilKunjungan(JSON.stringify({ alasanWajib: "tidak", fotoWajib: true }))).toEqual({
      alasanWajib: true,
      fotoWajib: true,
    });
    expect(bacaAturanHasilKunjungan(JSON.stringify({ alasanWajib: false }))).toEqual({
      alasanWajib: false,
      fotoWajib: false,
    });
  });

  it("tulis lalu baca kembali menghasilkan aturan yang sama", () => {
    const a = { alasanWajib: false, fotoWajib: true };
    expect(bacaAturanHasilKunjungan(tulisAturanHasilKunjungan(a))).toEqual(a);
  });

  it("tulis menolak bentuk yang tidak sah", () => {
    expect(tulisAturanHasilKunjungan({ alasanWajib: 1, fotoWajib: false } as never)).toBeNull();
    expect(tulisAturanHasilKunjungan(null as never)).toBeNull();
  });
});

describe("bacaAturanCheckin", () => {
  it("bawaan: mode peringatan, akurasi maksimal 100 m", () => {
    expect(ATURAN_CHECKIN_BAWAAN).toEqual({ modeRadius: "PERINGATAN", akurasiMaksMeter: 100 });
    expect(bacaAturanCheckin(null)).toEqual(ATURAN_CHECKIN_BAWAAN);
    expect(bacaAturanCheckin("rusak")).toEqual(ATURAN_CHECKIN_BAWAAN);
  });

  it("mode dan akurasi yang sah dipakai", () => {
    expect(bacaAturanCheckin(JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 250 }))).toEqual({
      modeRadius: "TOLAK",
      akurasiMaksMeter: 250,
    });
  });

  it("mode tak dikenal atau akurasi di luar batas → bawaan per kolom", () => {
    expect(bacaAturanCheckin(JSON.stringify({ modeRadius: "BLOKIR", akurasiMaksMeter: 250 }))).toEqual({
      modeRadius: "PERINGATAN",
      akurasiMaksMeter: 250,
    });
    expect(bacaAturanCheckin(JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 0 }))).toEqual({
      modeRadius: "TOLAK",
      akurasiMaksMeter: 100,
    });
    expect(bacaAturanCheckin(JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 12.5 })).akurasiMaksMeter).toBe(100);
    expect(bacaAturanCheckin(JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 999_999 })).akurasiMaksMeter).toBe(100);
  });

  it("tulis lalu baca kembali menghasilkan aturan yang sama", () => {
    const a = { modeRadius: "TOLAK" as const, akurasiMaksMeter: 75 };
    expect(bacaAturanCheckin(tulisAturanCheckin(a))).toEqual(a);
  });

  it("tulis menolak mode atau akurasi yang tidak sah", () => {
    expect(tulisAturanCheckin({ modeRadius: "X" as never, akurasiMaksMeter: 100 })).toBeNull();
    expect(tulisAturanCheckin({ modeRadius: "TOLAK", akurasiMaksMeter: 5 })).toBeNull();
    expect(tulisAturanCheckin({ modeRadius: "TOLAK", akurasiMaksMeter: Number.NaN })).toBeNull();
  });
});

describe("sahRadiusGlobal", () => {
  it("bilangan bulat 10–5000 m", () => {
    expect(sahRadiusGlobal(100)).toBe(true);
    expect(sahRadiusGlobal(10)).toBe(true);
    expect(sahRadiusGlobal(5000)).toBe(true);
    expect(sahRadiusGlobal(9)).toBe(false);
    expect(sahRadiusGlobal(5001)).toBe(false);
    expect(sahRadiusGlobal(50.5)).toBe(false);
    expect(sahRadiusGlobal(Number.NaN)).toBe(false);
    expect(sahRadiusGlobal("100")).toBe(false);
  });
});

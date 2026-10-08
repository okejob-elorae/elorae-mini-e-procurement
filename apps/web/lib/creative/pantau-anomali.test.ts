import { describe, expect, it } from "vitest";
import { cekAnomaliAkun, type CatatanAnomali } from "./pantau-anomali";
import { PANTAU_BAWAAN } from "./pantau-aturan";

/*
 * Anomali akun (keputusan P6): pengikut naik > 30% dibanding catatan
 * sebelumnya dalam ≤ 14 hari; ER akun turun > 40% dibanding catatan sebelumnya
 * yang ber-ER.
 */

const ambang = PANTAU_BAWAAN;
const hari = (n: number) => new Date(Date.UTC(2003, 0, 1 + n, 5));
const c = (n: number, followers: number, er: number | null = null): CatatanAnomali => ({ recordedAt: hari(n), followers, er });

describe("cekAnomaliAkun", () => {
  it("pengikut naik lebih dari 30% dalam 14 hari = anomali", () => {
    const r = cekAnomaliAkun([c(0, 10_000), c(7, 13_100)], ambang);
    expect(r.pengikut).toEqual({ dari: 10_000, ke: 13_100, persen: 31 });
  });

  it("naik tepat 30% belum anomali", () => {
    expect(cekAnomaliAkun([c(0, 10_000), c(7, 13_000)], ambang).pengikut).toBeNull();
  });

  it("kenaikan besar tapi berjarak lebih dari 14 hari bukan anomali", () => {
    expect(cekAnomaliAkun([c(0, 10_000), c(15, 20_000)], ambang).pengikut).toBeNull();
    expect(cekAnomaliAkun([c(0, 10_000), c(14, 20_000)], ambang).pengikut).not.toBeNull();
  });

  it("catatan sebelumnya 0 pengikut tidak bisa dibandingkan", () => {
    expect(cekAnomaliAkun([c(0, 0), c(1, 5_000)], ambang).pengikut).toBeNull();
  });

  it("ER turun lebih dari 40% = anomali; tepat 40% belum", () => {
    expect(cekAnomaliAkun([c(0, 1000, 5), c(30, 1000, 2.9)], ambang).er).toEqual({ dari: 5, ke: 2.9, persen: 42 });
    expect(cekAnomaliAkun([c(0, 1000, 5), c(30, 1000, 3)], ambang).er).toBeNull();
  });

  it("ER dibandingkan dengan catatan sebelumnya yang punya ER, melewati catatan manual tanpa ER", () => {
    const r = cekAnomaliAkun([c(0, 1000, 8), c(5, 1000, null), c(9, 1000, 4)], ambang);
    expect(r.er).toEqual({ dari: 8, ke: 4, persen: 50 });
  });

  it("catatan terbaru tanpa ER tidak memunculkan anomali ER", () => {
    expect(cekAnomaliAkun([c(0, 1000, 8), c(5, 1000, null)], ambang).er).toBeNull();
  });

  it("urutan masukan tidak penting; yang terbaru menurut tanggal catat", () => {
    const r = cekAnomaliAkun([c(7, 13_100), c(0, 10_000)], ambang);
    expect(r.pengikut?.ke).toBe(13_100);
    expect(r.terbaru?.getTime()).toBe(hari(7).getTime());
  });

  it("satu catatan saja: tidak ada pembanding", () => {
    expect(cekAnomaliAkun([c(0, 10_000, 5)], ambang)).toEqual({ pengikut: null, er: null, terbaru: hari(0) });
    expect(cekAnomaliAkun([], ambang)).toEqual({ pengikut: null, er: null, terbaru: null });
  });

  it("ambang mengikuti pengaturan", () => {
    const longgar = { ...ambang, naikPengikutPersen: 50, turunErPersen: 60 };
    expect(cekAnomaliAkun([c(0, 10_000, 5), c(7, 14_000, 2.5)], longgar)).toMatchObject({ pengikut: null, er: null });
  });
});

import { describe, expect, it } from "vitest";
import { kunciTokoHari, pengunjungDipakai, pengunjungRentang } from "./pengunjung";

describe("angka pengunjung tutup hari — sama dengan Kinerja SPG", () => {
  it("penghitung HP lebih dulu; laporan yang berbeda ditampilkan berdampingan", () => {
    expect(pengunjungDipakai(4, null)).toEqual({ angka: 4, sumber: "PENGHITUNG", laporanBeda: null });
    expect(pengunjungDipakai(4, 4)).toEqual({ angka: 4, sumber: "PENGHITUNG", laporanBeda: null });
    expect(pengunjungDipakai(4, 9)).toEqual({ angka: 4, sumber: "PENGHITUNG", laporanBeda: 9 });
    // 0 dari penghitung adalah hitungan, bukan "tidak ada".
    expect(pengunjungDipakai(0, 7)).toEqual({ angka: 0, sumber: "PENGHITUNG", laporanBeda: 7 });
  });

  it("tanpa penghitung: angka laporan tutup hari; tanpa keduanya: kosong", () => {
    expect(pengunjungDipakai(null, 12)).toEqual({ angka: 12, sumber: "LAPORAN", laporanBeda: null });
    expect(pengunjungDipakai(null, null)).toEqual({ angka: null, sumber: null, laporanBeda: null });
  });

  it("rentang: dijumlah per hari menurut aturan yang sama", () => {
    expect(
      pengunjungRentang([
        { penghitung: 7, laporan: null },
        { penghitung: 4, laporan: 10 },
        { penghitung: null, laporan: 5 },
        { penghitung: null, laporan: null },
      ]),
    ).toEqual({ angka: 16, adaDariLaporan: true });
    expect(pengunjungRentang([{ penghitung: 3, laporan: null }])).toEqual({ angka: 3, adaDariLaporan: false });
    expect(pengunjungRentang([{ penghitung: null, laporan: null }])).toEqual({ angka: null, adaDariLaporan: false });
    expect(kunciTokoHari("t1", "2026-10-06")).toBe("t1|2026-10-06");
  });
});

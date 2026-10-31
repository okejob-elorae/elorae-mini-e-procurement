import { describe, expect, it } from "vitest";
import { awalMingguIniWib, batasHariIniWib, tanggalWib, batasRentangWib, bulanIniWib } from "./hari-wib";

describe("batasHariIniWib", () => {
  it("jam 00.30 WIB (17.30 UTC kemarin) sudah hari baru di WIB", () => {
    const sekarang = new Date("2026-09-30T17:30:00Z"); // 1 Okt 00.30 WIB
    const b = batasHariIniWib(sekarang);
    expect(b.tanggal).toBe("2026-10-01");
    expect(b.awal.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(b.akhir.toISOString()).toBe("2026-10-01T16:59:59.999Z");
  });

  it("jam 23.59 WIB masih hari yang sama", () => {
    const b = batasHariIniWib(new Date("2026-10-01T16:59:00Z"));
    expect(b.tanggal).toBe("2026-10-01");
  });

  it("tidak bergantung pada setHours zona proses — tepat tengah malam WIB", () => {
    const b = batasHariIniWib(new Date("2026-10-01T05:00:00Z")); // 12.00 WIB
    expect(tanggalWib(b.awal)).toBe("2026-10-01");
    expect(tanggalWib(new Date(b.awal.getTime() - 1))).toBe("2026-09-30");
  });
});

describe("awalMingguIniWib", () => {
  it("Kamis 1 Okt 2026 → Senin 28 Sep 00.00 WIB", () => {
    expect(awalMingguIniWib(new Date("2026-10-01T05:00:00Z")).toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });

  it("Minggu masih milik minggu yang dimulai Senin sebelumnya", () => {
    // Minggu 4 Okt 2026, 10.00 WIB
    expect(awalMingguIniWib(new Date("2026-10-04T03:00:00Z")).toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });

  it("Senin 00.10 WIB adalah awal minggu baru, bukan minggu lalu", () => {
    // Senin 5 Okt 2026 00.10 WIB = Minggu 4 Okt 17.10 UTC
    expect(awalMingguIniWib(new Date("2026-10-04T17:10:00Z")).toISOString()).toBe("2026-10-04T17:00:00.000Z");
  });
});

describe("bulanIniWib — rentang bawaan 'bulan ini' di Laporan operasional", () => {
  it("1 sampai akhir bulan WIB, tidak bergeser sehari karena zona waktu", () => {
    // 6 Okt 2026 10.00 WIB. Dulu: new Date(y, m, 1).toISOString() di WIB → 30 Sep – 30 Okt.
    expect(bulanIniWib(new Date("2026-10-06T03:00:00Z"))).toEqual({ dari: "2026-10-01", sampai: "2026-10-31" });
  });

  it("memakai bulan WIB: 1 Nov 00.30 WIB sudah November walau UTC masih Oktober", () => {
    expect(bulanIniWib(new Date("2026-10-31T17:30:00Z"))).toEqual({ dari: "2026-11-01", sampai: "2026-11-30" });
  });

  it("Februari tahun kabisat dan Desember", () => {
    expect(bulanIniWib(new Date("2028-02-10T03:00:00Z"))).toEqual({ dari: "2028-02-01", sampai: "2028-02-29" });
    expect(bulanIniWib(new Date("2026-12-31T16:00:00Z"))).toEqual({ dari: "2026-12-01", sampai: "2026-12-31" });
  });
});

describe("batasRentangWib — tanggal isian jadi batas instan WIB", () => {
  it("dari 00.00 WIB sampai 23.59.59,999 WIB di hari terakhir", () => {
    const r = batasRentangWib("2026-10-01", "2026-10-31");
    expect(r.dari?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.sampai?.toISOString()).toBe("2026-10-31T16:59:59.999Z");
  });

  it("isian kosong atau rusak = tanpa batas di sisi itu", () => {
    expect(batasRentangWib("", "2026-10-31").dari).toBeUndefined();
    expect(batasRentangWib("2026-10-01", "bukan tanggal").sampai).toBeUndefined();
  });
});

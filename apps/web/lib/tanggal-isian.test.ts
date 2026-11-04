import { describe, expect, it } from "vitest";
import {
  bacaJam,
  bacaTanggal,
  dalamBatas,
  dariDateLokal,
  gabungWaktu,
  hariIniWib,
  jumlahHari,
  keDateLokal,
  labelRentang,
  pangkasRentang,
  rentangCepat,
  urutkanRentang,
  labelTanggal,
  pisahWaktu,
} from "./tanggal-isian";

describe("tanggal-isian", () => {
  it("menolak tanggal yang tidak ada, bukan menggesernya diam-diam", () => {
    expect(bacaTanggal("2026-02-31")).toBeNull();
    expect(bacaTanggal("2026-10-01")).toEqual({ tahun: 2026, bulan: 10, hari: 1 });
    expect(bacaTanggal("")).toBeNull();
    expect(bacaTanggal("1/10/2026")).toBeNull();
  });

  it("bolak-balik teks ↔ Date lokal tidak pernah menggeser harinya", () => {
    for (const t of ["2026-01-01", "2026-10-01", "2026-12-31", "2024-02-29"]) {
      expect(dariDateLokal(keDateLokal(t)!)).toBe(t);
    }
  });

  it("label mengikuti bahasa dan selalu hari yang tertulis", () => {
    expect(labelTanggal("2026-10-01", "id")).toBe("1 Okt 2026");
    expect(labelTanggal("2026-10-01", "en")).toBe("1 Oct 2026");
    expect(labelTanggal("", "id")).toBe("");
  });

  it("hari ini dihitung di WIB: 1 Okt 00.30 WIB masih 30 Sep di UTC", () => {
    expect(hariIniWib(new Date("2026-09-30T17:30:00Z"))).toBe("2026-10-01");
  });

  it("batas min/max inklusif, dan batas kosong tidak membatasi", () => {
    expect(dalamBatas("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(dalamBatas("2026-09-30", "2026-10-01", null)).toBe(false);
    expect(dalamBatas("2026-11-01", undefined, "2026-10-31")).toBe(false);
    expect(dalamBatas("2026-11-01", "", "")).toBe(true);
  });

  it("tanggal-dan-jam: dipisah dan digabung ulang tanpa berubah", () => {
    expect(pisahWaktu("2026-10-01T08:05")).toEqual({ tanggal: "2026-10-01", jam: "08:05" });
    expect(gabungWaktu("2026-10-01", "08:05")).toBe("2026-10-01T08:05");
    expect(gabungWaktu("2026-10-01", "")).toBe("2026-10-01T00:00");
    expect(gabungWaktu("", "08:05")).toBe("");
    expect(pisahWaktu("")).toEqual({ tanggal: "", jam: "" });
    expect(bacaJam("24:00")).toBeNull();
  });
});

describe("rentang tanggal", () => {
  it("label satu bulan, lintas bulan, lintas tahun, dan satu hari", () => {
    expect(labelRentang("2026-10-01", "2026-10-30", "id")).toBe("1–30 Okt 2026");
    expect(labelRentang("2026-09-28", "2026-10-03", "id")).toBe("28 Sep – 3 Okt 2026");
    expect(labelRentang("2025-12-28", "2026-01-03", "id")).toBe("28 Des 2025 – 3 Jan 2026");
    expect(labelRentang("2026-10-01", "2026-10-01", "id")).toBe("1 Okt 2026");
    // Terbalik tetap dibaca dari awal ke akhir; yang belum lengkap kosong.
    expect(labelRentang("2026-10-30", "2026-10-01", "id")).toBe("1–30 Okt 2026");
    expect(labelRentang("2026-10-01", "", "id")).toBe("");
  });

  it("label pendek tanpa tahun untuk daftar pilihan cepat", () => {
    expect(labelRentang("2026-09-01", "2026-09-30", "id", { tahun: false })).toBe("1–30 Sep");
    expect(labelRentang("2026-09-28", "2026-10-01", "id", { tahun: false })).toBe("28 Sep – 1 Okt");
    expect(labelRentang("2026-10-01", "2026-10-01", "id", { tahun: false })).toBe("1 Okt");
  });

  it("jumlah hari menghitung kedua ujung, ke arah mana pun, lintas bulan dan tahun kabisat", () => {
    expect(jumlahHari("2026-09-01", "2026-09-30")).toBe(30);
    expect(jumlahHari("2026-10-01", "2026-10-01")).toBe(1);
    expect(jumlahHari("2026-10-30", "2026-10-01")).toBe(30);
    expect(jumlahHari("2024-02-28", "2024-03-01")).toBe(3);
    expect(jumlahHari("2026-10-01", "")).toBe(0);
  });

  it("menarik dari belakang ke depan tetap menghasilkan awal ≤ akhir", () => {
    expect(urutkanRentang("2026-10-30", "2026-10-01")).toEqual({ dari: "2026-10-01", sampai: "2026-10-30" });
  });

  it("pilihan cepat dihitung dari hari ini WIB, termasuk pergantian bulan dan tahun", () => {
    expect(rentangCepat("tujuhHari", "2026-10-03")).toEqual({ dari: "2026-09-27", sampai: "2026-10-03" });
    expect(rentangCepat("tigaPuluhHari", "2026-10-01")).toEqual({ dari: "2026-09-02", sampai: "2026-10-01" });
    expect(rentangCepat("bulanIni", "2026-10-15")).toEqual({ dari: "2026-10-01", sampai: "2026-10-15" });
    expect(rentangCepat("bulanLalu", "2026-03-10")).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
    expect(rentangCepat("bulanLalu", "2026-01-05")).toEqual({ dari: "2025-12-01", sampai: "2025-12-31" });
    expect(rentangCepat("kemarin", "2026-01-01")).toEqual({ dari: "2025-12-31", sampai: "2025-12-31" });
    expect(rentangCepat("tahunIni", "2026-10-01")).toEqual({ dari: "2026-01-01", sampai: "2026-10-01" });
    // 1 Okt 2026 hari Kamis: minggu ini mulai Senin 28 Sep, minggu lalu 21–27 Sep.
    expect(rentangCepat("mingguIni", "2026-10-01")).toEqual({ dari: "2026-09-28", sampai: "2026-10-01" });
    expect(rentangCepat("mingguLalu", "2026-10-01")).toEqual({ dari: "2026-09-21", sampai: "2026-09-27" });
    // Hari Minggu masih minggu yang dimulai Senin sebelumnya, bukan minggu baru.
    expect(rentangCepat("mingguIni", "2026-10-04")).toEqual({ dari: "2026-09-28", sampai: "2026-10-04" });
    expect(rentangCepat("sembilanPuluhHari", "2026-10-01")).toEqual({ dari: "2026-07-04", sampai: "2026-10-01" });
  });

  it("dipangkas ke batas; yang di luar batas seluruhnya ditolak", () => {
    const r = { dari: "2026-09-01", sampai: "2026-10-31" };
    expect(pangkasRentang(r, "2026-10-01", "2026-10-15")).toEqual({ dari: "2026-10-01", sampai: "2026-10-15" });
    expect(pangkasRentang(r, "2026-11-01", null)).toBeNull();
    expect(pangkasRentang(r, "", "")).toEqual(r);
  });
});

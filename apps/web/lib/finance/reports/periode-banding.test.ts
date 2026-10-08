import { describe, expect, it } from "vitest";
import { awalBulanIni, jumlahHari, periodeBanding, posisiBanding, tanggalSah } from "./periode-banding";

describe("periodeBanding — Laba Rugi: periode ini vs periode sebelumnya vs tahun lalu", () => {
  it("satu bulan penuh: bulan lalu (panjang bulannya sendiri) dan bulan yang sama tahun lalu", () => {
    expect(periodeBanding("2026-09-01", "2026-09-30")).toEqual({
      sebelumnya: { dari: "2026-08-01", sampai: "2026-08-31" },
      tahunLalu: { dari: "2025-09-01", sampai: "2025-09-30" },
    });
  });

  it("bulan berjalan (tanggal 1 s.d. hari ini): rentang tanggal yang sama di bulan lalu", () => {
    expect(periodeBanding("2026-10-01", "2026-10-08")).toEqual({
      sebelumnya: { dari: "2026-09-01", sampai: "2026-09-08" },
      tahunLalu: { dari: "2025-10-01", sampai: "2025-10-08" },
    });
  });

  it("tanggal akhir dijepit ke akhir bulan pembanding", () => {
    // 1–31 Maret → Februari (28 hari di 2026), bukan 3 Maret.
    expect(periodeBanding("2026-03-01", "2026-03-31").sebelumnya).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
    // Bulan berjalan sampai tanggal 30 → Februari dijepit ke 28.
    expect(periodeBanding("2026-03-01", "2026-03-30").sebelumnya).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
    // Akhir Februari tahun kabisat → akhir Februari tahun lalu.
    expect(periodeBanding("2028-02-01", "2028-02-29").tahunLalu).toEqual({ dari: "2027-02-01", sampai: "2027-02-28" });
  });

  it("beberapa bulan penuh: mundur sebanyak bulannya", () => {
    expect(periodeBanding("2026-07-01", "2026-09-30")).toEqual({
      sebelumnya: { dari: "2026-04-01", sampai: "2026-06-30" },
      tahunLalu: { dari: "2025-07-01", sampai: "2025-09-30" },
    });
  });

  it("satu tahun penuh: tahun lalu sekaligus pembanding sebelumnya", () => {
    expect(periodeBanding("2026-01-01", "2026-12-31")).toEqual({
      sebelumnya: { dari: "2025-01-01", sampai: "2025-12-31" },
      tahunLalu: { dari: "2025-01-01", sampai: "2025-12-31" },
    });
  });

  it("rentang bebas (tidak mulai tanggal 1): jendela sama panjang tepat sebelumnya", () => {
    expect(periodeBanding("2026-09-15", "2026-09-21")).toEqual({
      sebelumnya: { dari: "2026-09-08", sampai: "2026-09-14" },
      tahunLalu: { dari: "2025-09-15", sampai: "2025-09-21" },
    });
  });

  it("melintasi pergantian tahun", () => {
    expect(periodeBanding("2026-01-01", "2026-01-31").sebelumnya).toEqual({ dari: "2025-12-01", sampai: "2025-12-31" });
  });
});

describe("posisiBanding — Neraca: per tanggal vs akhir bulan sebelumnya vs tahun lalu", () => {
  it("akhir bulan → akhir bulan lalu dan akhir bulan yang sama tahun lalu", () => {
    expect(posisiBanding("2026-09-30")).toEqual({ sebelumnya: "2026-08-31", tahunLalu: "2025-09-30" });
    expect(posisiBanding("2028-02-29")).toEqual({ sebelumnya: "2028-01-31", tahunLalu: "2027-02-28" });
  });

  it("pertengahan bulan → akhir bulan sebelumnya", () => {
    expect(posisiBanding("2026-10-08")).toEqual({ sebelumnya: "2026-09-30", tahunLalu: "2025-10-08" });
    expect(posisiBanding("2026-01-15")).toEqual({ sebelumnya: "2025-12-31", tahunLalu: "2025-01-15" });
  });
});

describe("jumlahHari", () => {
  it("inklusif", () => {
    expect(jumlahHari("2026-09-01", "2026-09-30")).toBe(30);
    expect(jumlahHari("2026-01-01", "2026-12-31")).toBe(365);
    expect(jumlahHari("2026-09-01", "2026-09-01")).toBe(1);
  });
});

describe("awalBulanIni", () => {
  it("tanggal 1 bulan dari tanggal WIB yang diberikan", () => {
    expect(awalBulanIni("2026-10-08")).toBe("2026-10-01");
  });
});

describe("tanggalSah", () => {
  it("menolak tanggal yang tidak ada di kalender", () => {
    expect(tanggalSah("2026-02-29")).toBeNull();
    expect(tanggalSah("2026-13-01")).toBeNull();
    expect(tanggalSah("x")).toBeNull();
    expect(tanggalSah("2028-02-29")).toBe("2028-02-29");
  });
});

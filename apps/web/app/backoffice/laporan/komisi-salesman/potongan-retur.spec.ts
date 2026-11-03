import { describe, expect, it } from "vitest";
import { awalanKembaliRetur, awalanPotongRetur, ringkasPotonganRetur } from "./potongan-retur";

describe("ringkasPotonganRetur", () => {
  it("memakai awalan refId yang sama dengan penulis potongan (potong-beban-retur.ts)", () => {
    expect(awalanPotongRetur("s1", "2026-11")).toBe("s1:2026-11:");
    expect(awalanKembaliRetur("s1", "2026-11")).toBe("kembali:s1:2026-11:");
  });

  it("sisa dan kelebihan dihitung per beban, tidak saling meniadakan antarbeban", () => {
    const r = ringkasPotonganRetur({
      salesmanIds: ["s1"],
      bulan: "2026-11",
      beban: [
        { bearerUserId: "s1", amount: 100_000, settledAmount: 40_000 },
        // Barangnya ketemu: besarnya turun di bawah yang sudah dipotong.
        { bearerUserId: "s1", amount: 10_000, settledAmount: 25_000 },
        { bearerUserId: "s2", amount: 999_999, settledAmount: 0 },
      ],
      potongan: [],
    });
    expect(r.s1).toEqual({ sisa: 60_000, dipotongBulanIni: 0, kelebihan: 15_000, dikembalikanBulanIni: 0 });
  });

  it("potongan dan pengembalian hanya bulan laporan dan hanya milik orang itu; pengembalian tampil positif", () => {
    const r = ringkasPotonganRetur({
      salesmanIds: ["s1", "s2"],
      bulan: "2026-11",
      beban: [],
      potongan: [
        { refId: "s1:2026-11:kunci-satu", amount: 20_000 },
        { refId: "s1:2026-11:kunci-dua", amount: 5_000.5 },
        { refId: "s1:2026-10:kunci-lama", amount: 70_000 },
        { refId: "kembali:s1:2026-11:kunci-tiga", amount: -3_000 },
        { refId: "kembali:s1:2026-10:kunci-empat", amount: -8_000 },
        { refId: "s2:2026-11:kunci-lima", amount: 1_000 },
      ],
    });
    expect(r.s1).toEqual({ sisa: 0, dipotongBulanIni: 25_000.5, kelebihan: 0, dikembalikanBulanIni: 3_000 });
    expect(r.s2).toEqual({ sisa: 0, dipotongBulanIni: 1_000, kelebihan: 0, dikembalikanBulanIni: 0 });
  });

  it("setiap id yang diminta mendapat baris nol, dan id ganda hanya sekali", () => {
    const r = ringkasPotonganRetur({ salesmanIds: ["s9", "s9"], bulan: "2026-11", beban: [], potongan: [] });
    expect(Object.keys(r)).toEqual(["s9"]);
    expect(r.s9).toEqual({ sisa: 0, dipotongBulanIni: 0, kelebihan: 0, dikembalikanBulanIni: 0 });
  });

  it("membulatkan ke sen seperti penulisnya", () => {
    const r = ringkasPotonganRetur({
      salesmanIds: ["s1"],
      bulan: "2026-11",
      beban: [{ bearerUserId: "s1", amount: 0.3, settledAmount: 0.1 }],
      potongan: [],
    });
    expect(r.s1.sisa).toBe(0.2);
  });
});

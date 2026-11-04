import { describe, expect, it } from "vitest";
import {
  alamatFollowUp,
  bacaBulan,
  bacaParamFollowUp,
  geserBulan,
  kisiBulan,
  pesanWaFollowUp,
  selisihHari,
  statusBerikutnya,
  tautanWaFollowUp,
} from "./follow-up";

const HARI_INI = "2026-10-07";

describe("bacaParamFollowUp", () => {
  it("tanpa alamat: tab Hari ini, semua pemasok, halaman 1, daftar, bulan ini", () => {
    expect(bacaParamFollowUp({}, HARI_INI)).toEqual({
      saring: "hari-ini",
      pemasok: null,
      halaman: 1,
      tampilan: "daftar",
      bulan: "2026-10",
    });
  });

  it("membaca tautan Beranda dan saringan yang sah", () => {
    expect(bacaParamFollowUp({ saring: "terlambat" }, HARI_INI).saring).toBe("terlambat");
    expect(bacaParamFollowUp({ saring: "minggu-ini", pemasok: "sup1", halaman: "3" }, HARI_INI)).toMatchObject({
      saring: "minggu-ini",
      pemasok: "sup1",
      halaman: 3,
    });
    expect(bacaParamFollowUp({ tampilan: "kalender", bulan: "2027-01" }, HARI_INI)).toMatchObject({
      tampilan: "kalender",
      bulan: "2027-01",
    });
  });

  it("nilai rusak jatuh ke bawaan, tidak pernah melempar", () => {
    expect(
      bacaParamFollowUp({ saring: "kemarin", halaman: "-2", tampilan: "papan", bulan: "2026-13", pemasok: "  " }, HARI_INI),
    ).toEqual({ saring: "hari-ini", pemasok: null, halaman: 1, tampilan: "daftar", bulan: "2026-10" });
    expect(bacaParamFollowUp({ halaman: "1.5" }, HARI_INI).halaman).toBe(1);
    expect(bacaParamFollowUp({ pemasok: "x".repeat(65) }, HARI_INI).pemasok).toBeNull();
    expect(bacaParamFollowUp({ saring: ["terlambat", "semua"] }, HARI_INI).saring).toBe("terlambat");
  });
});

describe("alamatFollowUp", () => {
  const dasar = bacaParamFollowUp({}, HARI_INI);

  it("keadaan bawaan = alamat polos", () => {
    expect(alamatFollowUp(dasar, HARI_INI)).toBe("/backoffice/production/follow-up");
  });

  it("menulis saringan, halaman, dan pemasok; kembali terbaca sama", () => {
    const p = { ...dasar, saring: "terlambat" as const, halaman: 2, pemasok: "sup1" };
    const alamat = alamatFollowUp(p, HARI_INI);
    expect(alamat).toBe("/backoffice/production/follow-up?saring=terlambat&halaman=2&pemasok=sup1");
    const qs = Object.fromEntries(new URL(alamat, "http://x").searchParams);
    expect(bacaParamFollowUp(qs, HARI_INI)).toEqual(p);
  });

  it("kalender tidak membawa tab dan halaman daftar; bulan ini tidak ditulis", () => {
    expect(alamatFollowUp({ ...dasar, tampilan: "kalender", saring: "semua", halaman: 4 }, HARI_INI)).toBe(
      "/backoffice/production/follow-up?tampilan=kalender",
    );
    expect(alamatFollowUp({ ...dasar, tampilan: "kalender", bulan: "2026-11" }, HARI_INI)).toBe(
      "/backoffice/production/follow-up?tampilan=kalender&bulan=2026-11",
    );
  });
});

describe("bulan", () => {
  it("bacaBulan hanya YYYY-MM yang sah", () => {
    expect(bacaBulan("2026-10")).toEqual({ tahun: 2026, bulan: 10 });
    expect(bacaBulan("2026-00")).toBeNull();
    expect(bacaBulan("1999-12")).toBeNull();
    expect(bacaBulan("2026-1")).toBeNull();
  });

  it("geserBulan melewati pergantian tahun", () => {
    expect(geserBulan("2026-12", 1)).toBe("2027-01");
    expect(geserBulan("2026-01", -1)).toBe("2025-12");
    expect(geserBulan("2026-10", 0)).toBe("2026-10");
    expect(geserBulan("2026-10", -22)).toBe("2024-12");
  });
});

describe("kisiBulan", () => {
  it("minggu dimulai Senin; Oktober 2026 dimulai Kamis", () => {
    const kisi = kisiBulan("2026-10");
    expect(kisi[0][0]).toEqual({ tanggal: "2026-09-28", diBulan: false });
    expect(kisi[0][3]).toEqual({ tanggal: "2026-10-01", diBulan: true });
    expect(kisi.every((m) => m.length === 7)).toBe(true);
    const diBulan = kisi.flat().filter((h) => h.diBulan).map((h) => h.tanggal);
    expect(diBulan).toHaveLength(31);
    expect(diBulan[0]).toBe("2026-10-01");
    expect(diBulan.at(-1)).toBe("2026-10-31");
    expect(kisi).toHaveLength(5);
  });

  it("bulan yang dimulai Senin tidak membawa minggu kosong di depan; Februari 28 hari muat 4 minggu", () => {
    const feb = kisiBulan("2027-02");
    expect(feb[0][0]).toEqual({ tanggal: "2027-02-01", diBulan: true });
    expect(feb).toHaveLength(4);
  });

  it("bulan enam minggu (Agustus 2026: mulai Sabtu, 31 hari)", () => {
    const agu = kisiBulan("2026-08");
    expect(agu).toHaveLength(6);
    expect(agu[5].some((h) => h.tanggal === "2026-08-31")).toBe(true);
  });

  it("alamat bulan rusak → kisi kosong", () => {
    expect(kisiBulan("2026-13")).toEqual([]);
  });
});

describe("selisihHari", () => {
  it("negatif untuk yang sudah lewat, nol hari ini", () => {
    expect(selisihHari("2026-10-04", HARI_INI)).toBe(-3);
    expect(selisihHari(HARI_INI, HARI_INI)).toBe(0);
    expect(selisihHari("2026-11-01", HARI_INI)).toBe(25);
  });
});

describe("pesan WhatsApp ke pemasok", () => {
  const pesan = pesanWaFollowUp({ pemasok: "CV Jahit Rapi", langkah: "Jahit", tahap: "Kemeja batch 1", target: "2026-10-12" });

  it("teks bahasa Indonesia dengan tanggal terbaca", () => {
    expect(pesan).toBe("Halo CV Jahit Rapi, menanyakan proses Jahit untuk Kemeja batch 1 — target 12 Okt 2026.");
  });

  it("dipasang ke tautan wa.me dari server, terenkode", () => {
    const tautan = tautanWaFollowUp("https://wa.me/6281234567890", pesan);
    expect(tautan).toBe(`https://wa.me/6281234567890?text=${encodeURIComponent(pesan)}`);
    expect(new URL(tautan!).searchParams.get("text")).toBe(pesan);
  });

  it("tanpa nomor, atau tautan yang bukan wa.me, tidak menghasilkan tautan", () => {
    expect(tautanWaFollowUp(null, pesan)).toBeNull();
    expect(tautanWaFollowUp("https://contoh.com/6281", pesan)).toBeNull();
    expect(tautanWaFollowUp("https://wa.me/6281?text=lain", pesan)).toBeNull();
  });
});

describe("statusBerikutnya", () => {
  it("Belum → Proses, Proses/Selesai → Selesai", () => {
    expect(statusBerikutnya("BELUM")).toBe("PROSES");
    expect(statusBerikutnya("PROSES")).toBe("SELESAI");
    expect(statusBerikutnya("SELESAI")).toBe("SELESAI");
  });
});

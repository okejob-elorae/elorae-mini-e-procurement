import { describe, expect, it } from "vitest";
import { hariWib, kirimanBelumDipegang, kirimanLepasDariHp, kunciKiriman, labelMasuk, labelMasukUntuk, tataKunjunganBeranda } from "./beranda-spg";

describe("labelMasuk / labelMasukUntuk", () => {
  // Senin 5 Okt 2026 19.16 WIB = 12.16 UTC.
  const masuk = new Date("2026-10-05T12:16:00Z");

  it("check-in hari ini (WIB): jam saja", () => {
    const l = labelMasuk(masuk);
    expect(l.hari).toBe("2026-10-05");
    expect(labelMasukUntuk(l, "2026-10-05")).toEqual({ lama: false, teks: "19.16" });
  });

  it("check-in hari lain: dengan hari dan tanggalnya, tidak terbaca seperti hari ini", () => {
    const r = labelMasukUntuk(labelMasuk(masuk), "2026-10-06");
    expect(r.lama).toBe(true);
    expect(r.teks).toContain("Senin");
    expect(r.teks).toContain("5 Okt");
    expect(r.teks).toContain("19.16");
  });

  it("hari mengikuti WIB, bukan UTC: 23.30 WIB masih hari yang sama", () => {
    expect(hariWib(new Date("2026-10-05T16:30:00Z"))).toBe("2026-10-05");
    expect(hariWib(new Date("2026-10-05T17:30:00Z"))).toBe("2026-10-06");
  });
});

describe("kirimanBelumDipegang", () => {
  const menunggu = [kunciKiriman("PUTUS_DELIVERY", "d1"), kunciKiriman("KONSI_ORDER", "o1"), kunciKiriman("MUTASI", "m1")];

  it("kiriman yang tanda terimanya sudah di HP (menunggu sinyal atau ditolak) tidak dihitung lagi", () => {
    expect(
      kirimanBelumDipegang(
        menunggu,
        [
          { storeId: "S", sourceType: "KONSI_ORDER", sourceId: "o1" },
          { storeId: "S", sourceType: "MUTASI", sourceId: "m1" },
        ],
        "S",
      ),
    ).toBe(1);
  });

  it("antrean untuk toko lain dan dokumen yang tidak menunggu lagi tidak mengurangi apa pun", () => {
    expect(
      kirimanBelumDipegang(
        menunggu,
        [
          { storeId: "T", sourceType: "PUTUS_DELIVERY", sourceId: "d1" },
          { storeId: "S", sourceType: "PUTUS_DELIVERY", sourceId: "lama" },
        ],
        "S",
      ),
    ).toBe(3);
  });

  it("tanpa antrean: sama dengan jumlah yang menunggu", () => {
    expect(kirimanBelumDipegang(menunggu, [], "S")).toBe(3);
  });
});

describe("kirimanLepasDariHp", () => {
  const menunggu = [kunciKiriman("PUTUS_DELIVERY", "d1"), kunciKiriman("KONSI_ORDER", "o1")];

  it("tanda terima yang tadi di HP sudah lepas (terkirim) padahal halaman masih menghitungnya: muat ulang", () => {
    expect(kirimanLepasDariHp(new Set(["KONSI_ORDER:o1"]), new Set(), menunggu)).toBe(true);
  });

  it("bacaan pertama, antrean yang tetap, atau yang lepas bukan kiriman halaman ini: tidak", () => {
    expect(kirimanLepasDariHp(null, new Set(), menunggu)).toBe(false);
    expect(kirimanLepasDariHp(new Set(["KONSI_ORDER:o1"]), new Set(["KONSI_ORDER:o1"]), menunggu)).toBe(false);
    expect(kirimanLepasDariHp(new Set(["MUTASI:lain"]), new Set(), menunggu)).toBe(false);
  });
});

describe("tataKunjunganBeranda", () => {
  const hariIni = { lama: false };
  const kemarin = { lama: true };

  it("check-in tanpa sinyal dari hari lain: Jual tidak ditawarkan, kartu kunjungannya SEKALI (di kartu absen)", () => {
    expect(tataKunjunganBeranda({ server: null, lokal: kemarin })).toEqual({ bisaJual: false, tombolDiKartu: true, tombolDiBawah: null });
  });

  it("check-in tanpa sinyal hari ini: Jual, kartu kunjungannya di bawah", () => {
    expect(tataKunjunganBeranda({ server: null, lokal: hariIni })).toEqual({ bisaJual: true, tombolDiKartu: false, tombolDiBawah: "LOKAL" });
  });

  it("kunjungan server dari hari lain: check-out di kartu absen, tanpa Jual", () => {
    expect(tataKunjunganBeranda({ server: kemarin, lokal: null })).toEqual({ bisaJual: false, tombolDiKartu: true, tombolDiBawah: null });
    expect(tataKunjunganBeranda({ server: hariIni, lokal: null })).toEqual({ bisaJual: true, tombolDiKartu: false, tombolDiBawah: "SERVER" });
    expect(tataKunjunganBeranda({ server: null, lokal: null })).toEqual({ bisaJual: false, tombolDiKartu: true, tombolDiBawah: null });
  });

  it("tombol kunjungan tidak pernah dirender dua kali", () => {
    const pilihan = [null, hariIni, kemarin];
    for (const server of pilihan)
      for (const lokal of pilihan) {
        const t = tataKunjunganBeranda({ server, lokal });
        expect(t.tombolDiKartu && t.tombolDiBawah !== null).toBe(false);
      }
  });
});

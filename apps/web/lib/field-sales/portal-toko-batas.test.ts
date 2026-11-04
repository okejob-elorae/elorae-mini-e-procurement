import { describe, it, expect } from "vitest";
import { BatasHarianPortalError, buatPembatasJendela, JENDELA_PERIKSA_PORTAL_MS, MAKS_PERIKSA_PORTAL_PER_MENIT } from "./portal-toko-batas";

describe("pembatas jendela (pratinjau/kirim portal per tautan)", () => {
  it("bawaan: 30 per 60 detik per tautan", () => {
    expect(MAKS_PERIKSA_PORTAL_PER_MENIT).toBe(30);
    expect(JENDELA_PERIKSA_PORTAL_MS).toBe(60_000);
  });

  it("menolak yang ke-(maks+1) di dalam jendela, per kunci", () => {
    const p = buatPembatasJendela(3, 60_000);
    expect([p.coba("l1", 0), p.coba("l1", 10), p.coba("l1", 20)]).toEqual([true, true, true]);
    expect(p.coba("l1", 30)).toBe(false);
    // Tautan lain punya jatahnya sendiri.
    expect(p.coba("l2", 30)).toBe(true);
  });

  it("jendela bergeser: jatah kembali saat percobaan tertua sudah lewat 60 detik", () => {
    const p = buatPembatasJendela(2, 60_000);
    expect(p.coba("l1", 0)).toBe(true);
    expect(p.coba("l1", 30_000)).toBe(true);
    expect(p.coba("l1", 59_999)).toBe(false);
    expect(p.coba("l1", 60_000)).toBe(true);
    expect(p.coba("l1", 60_001)).toBe(false);
  });

  it("penolakan tidak ikut dihitung (penebak yang terus menekan tidak memperpanjang hukumannya sendiri)", () => {
    const p = buatPembatasJendela(1, 1000);
    expect(p.coba("l1", 0)).toBe(true);
    for (let t = 1; t < 1000; t += 100) expect(p.coba("l1", t)).toBe(false);
    expect(p.coba("l1", 1000)).toBe(true);
  });

  it("kunci yang sudah sepi dibuang — peta tidak tumbuh tanpa batas", () => {
    const p = buatPembatasJendela(1, 1000);
    for (let i = 0; i < 50; i++) p.coba(`l${i}`, 0);
    expect(p.ukuran()).toBe(50);
    p.coba("baru", 5000);
    expect(p.ukuran()).toBe(1);
  });

  it("galat batas harian membawa batasnya", () => {
    const e = new BatasHarianPortalError(5);
    expect(e).toBeInstanceOf(Error);
    expect(e.batas).toBe(5);
  });
});

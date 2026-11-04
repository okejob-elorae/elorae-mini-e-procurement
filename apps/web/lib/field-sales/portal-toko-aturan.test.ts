import { describe, it, expect } from "vitest";
import {
  ATURAN_PORTAL_BAWAAN,
  bacaAturanPortalToko,
  bentukTokenSah,
  BATAS_TERBATAS,
  batasPesanPortal,
  emberPortal,
  KELIPATAN_STOK_PORTAL,
  emberBarang,
  emberKetersediaan,
  keadaanTautan,
  masaBerlakuDari,
  periksaTautan,
  sahkanAturanPortalToko,
} from "./portal-toko-aturan";

const sekarang = new Date("2026-10-01T05:00:00.000Z");
const besok = new Date("2026-10-02T05:00:00.000Z");
const kemarin = new Date("2026-09-30T05:00:00.000Z");

describe("bacaAturanPortalToko", () => {
  it("absent or broken → defaults (aktif, 90 days, 5 orders/day)", () => {
    expect(bacaAturanPortalToko(null)).toEqual({ aktif: true, masaBerlakuHari: 90, maksPesananPerHari: 5 });
    expect(bacaAturanPortalToko("{bukan json")).toEqual(ATURAN_PORTAL_BAWAAN);
    expect(bacaAturanPortalToko("[1,2]")).toEqual(ATURAN_PORTAL_BAWAAN);
  });

  it("each field falls back on its own; out-of-range numbers fall back too", () => {
    expect(bacaAturanPortalToko(JSON.stringify({ aktif: false }))).toEqual({ ...ATURAN_PORTAL_BAWAAN, aktif: false });
    expect(bacaAturanPortalToko(JSON.stringify({ masaBerlakuHari: 0, maksPesananPerHari: 999 }))).toEqual(ATURAN_PORTAL_BAWAAN);
    expect(bacaAturanPortalToko(JSON.stringify({ masaBerlakuHari: 2.5 }))).toEqual(ATURAN_PORTAL_BAWAAN);
    expect(bacaAturanPortalToko(JSON.stringify({ masaBerlakuHari: 30, maksPesananPerHari: 2 }))).toEqual({
      aktif: true,
      masaBerlakuHari: 30,
      maksPesananPerHari: 2,
    });
  });

  it("a saved rule reads back identically", () => {
    const a = { aktif: false, masaBerlakuHari: 14, maksPesananPerHari: 3 };
    expect(bacaAturanPortalToko(JSON.stringify(a))).toEqual(a);
  });
});

describe("sahkanAturanPortalToko", () => {
  it("rejects out-of-range values instead of clamping", () => {
    expect(sahkanAturanPortalToko({ aktif: true, masaBerlakuHari: 366, maksPesananPerHari: 5 })).toBeNull();
    expect(sahkanAturanPortalToko({ aktif: true, masaBerlakuHari: 30, maksPesananPerHari: 0 })).toBeNull();
    expect(sahkanAturanPortalToko({ aktif: "ya", masaBerlakuHari: 30, maksPesananPerHari: 5 })).toBeNull();
    expect(sahkanAturanPortalToko(null)).toBeNull();
  });

  it("keeps only the three known fields", () => {
    expect(sahkanAturanPortalToko({ aktif: true, masaBerlakuHari: 30, maksPesananPerHari: 5, lain: 1 })).toEqual({
      aktif: true,
      masaBerlakuHari: 30,
      maksPesananPerHari: 5,
    });
  });
});

describe("bentukTokenSah", () => {
  it("accepts exactly 43 base64url characters", () => {
    expect(bentukTokenSah("a".repeat(43))).toBe(true);
    expect(bentukTokenSah("Ab0_-".repeat(8) + "abc")).toBe(true);
  });

  it("rejects anything else before it is hashed or looked up", () => {
    expect(bentukTokenSah("a".repeat(42))).toBe(false);
    expect(bentukTokenSah("a".repeat(44))).toBe(false);
    expect(bentukTokenSah("a".repeat(42) + "/")).toBe(false);
    expect(bentukTokenSah("a".repeat(42) + "=")).toBe(false);
    expect(bentukTokenSah(123)).toBe(false);
    expect(bentukTokenSah(undefined)).toBe(false);
    expect(bentukTokenSah("x".repeat(10_000))).toBe(false);
  });
});

describe("periksaTautan", () => {
  const aturan = ATURAN_PORTAL_BAWAAN;
  const tautan = { revokedAt: null, expiresAt: besok };
  const toko = { isActive: true, salesmanId: "s1" };

  it("valid link → null", () => {
    expect(periksaTautan({ aturan, tautan, toko, sekarang })).toBeNull();
  });

  it("each failure has its own code", () => {
    expect(periksaTautan({ aturan: { ...aturan, aktif: false }, tautan, toko, sekarang })).toBe("PORTAL_NONAKTIF");
    expect(periksaTautan({ aturan, tautan: null, toko, sekarang })).toBe("TIDAK_DIKENAL");
    expect(periksaTautan({ aturan, tautan: { ...tautan, revokedAt: kemarin }, toko, sekarang })).toBe("DICABUT");
    expect(periksaTautan({ aturan, tautan: { ...tautan, expiresAt: kemarin }, toko, sekarang })).toBe("KEDALUWARSA");
    expect(periksaTautan({ aturan, tautan, toko: null, sekarang })).toBe("TIDAK_DIKENAL");
    expect(periksaTautan({ aturan, tautan, toko: { ...toko, isActive: false }, sekarang })).toBe("TOKO_NONAKTIF");
    expect(periksaTautan({ aturan, tautan, toko: { ...toko, salesmanId: null }, sekarang })).toBe("TANPA_PEMEGANG");
  });

  it("expiry is exclusive: a link expiring exactly now is already dead", () => {
    expect(periksaTautan({ aturan, tautan: { ...tautan, expiresAt: sekarang }, toko, sekarang })).toBe("KEDALUWARSA");
  });

  it("portal off wins over everything; revoked wins over expired", () => {
    expect(periksaTautan({ aturan: { ...aturan, aktif: false }, tautan: null, toko: null, sekarang })).toBe("PORTAL_NONAKTIF");
    expect(periksaTautan({ aturan, tautan: { revokedAt: kemarin, expiresAt: kemarin }, toko, sekarang })).toBe("DICABUT");
  });
});

describe("keadaanTautan / masaBerlakuDari", () => {
  it("revoked beats expired; otherwise active", () => {
    expect(keadaanTautan({ revokedAt: kemarin, expiresAt: kemarin }, sekarang)).toBe("DICABUT");
    expect(keadaanTautan({ revokedAt: null, expiresAt: kemarin }, sekarang)).toBe("KEDALUWARSA");
    expect(keadaanTautan({ revokedAt: null, expiresAt: besok }, sekarang)).toBe("AKTIF");
    expect(keadaanTautan({ revokedAt: null, expiresAt: null }, sekarang)).toBe("AKTIF");
  });

  it("expiry is N × 24 hours from now", () => {
    expect(masaBerlakuDari(sekarang, 90).getTime() - sekarang.getTime()).toBe(90 * 86_400_000);
  });
});

describe("ember ketersediaan", () => {
  it("never exposes the number, only the bucket", () => {
    expect(emberKetersediaan(0)).toBe("HABIS");
    expect(emberKetersediaan(-4)).toBe("HABIS");
    expect(emberKetersediaan(Number.NaN)).toBe("HABIS");
    expect(emberKetersediaan(1)).toBe("TERBATAS");
    expect(emberKetersediaan(BATAS_TERBATAS - 1)).toBe("TERBATAS");
    expect(emberKetersediaan(BATAS_TERBATAS)).toBe("TERSEDIA");
  });

  it("an item takes its best variant's bucket", () => {
    expect(emberBarang(["HABIS", "TERBATAS"])).toBe("TERBATAS");
    expect(emberBarang(["HABIS", "TERSEDIA", "TERBATAS"])).toBe("TERSEDIA");
    expect(emberBarang(["HABIS"])).toBe("HABIS");
    expect(emberBarang([])).toBe("HABIS");
  });
});

describe("batas pesan portal — stok dibulatkan ke bawah per kelipatan", () => {
  it("portal menawarkan stok per kelipatan; sisa di bawah satu kelipatan tidak ditawarkan", () => {
    expect(KELIPATAN_STOK_PORTAL).toBe(6);
    expect(batasPesanPortal(0)).toBe(0);
    expect(batasPesanPortal(-3)).toBe(0);
    expect(batasPesanPortal(Number.NaN)).toBe(0);
    expect(batasPesanPortal(5)).toBe(0);
    expect(batasPesanPortal(6)).toBe(6);
    expect(batasPesanPortal(11)).toBe(6);
    expect(batasPesanPortal(100)).toBe(96);
    expect(batasPesanPortal(101.9)).toBe(96);
  });

  it("dua stok di dalam kelipatan yang sama memberi jawaban yang sama — angka persisnya tidak bisa ditebak", () => {
    for (let n = 36; n < 42; n++) expect(batasPesanPortal(n)).toBe(36);
  });

  it("ember portal mengikuti apa yang bisa dipesan, bukan stok mentah", () => {
    expect(emberPortal(5)).toBe("HABIS");
    expect(emberPortal(6)).toBe("TERBATAS");
    expect(emberPortal(11)).toBe("TERBATAS");
    expect(emberPortal(12)).toBe("TERSEDIA");
  });
});

import { describe, expect, it } from "vitest";
import { bagianBisaDibuang, KODE_ALASAN_NOTA_SPG, kunciAlasanNotaSpg, nasibNotaSpg } from "./spg-jual-klasifikasi";

describe("nasibNotaSpg", () => {
  it("removes the receipt from the phone once the server has it — a replay of the same key included", () => {
    expect(nasibNotaSpg({ ok: true, spgSaleId: "s1", docNo: "SPG/1", changeGiven: 0, total: 1000 })).toBe("evict");
  });

  it("retries a lost send (thrown) — the sale may or may not have reached the server", () => {
    expect(nasibNotaSpg({ thrown: true })).toBe("retry");
  });

  it("stops on EVERY returned code, so the SPG sees why instead of 'waiting for signal' forever", () => {
    for (const code of KODE_ALASAN_NOTA_SPG) {
      expect(nasibNotaSpg({ ok: false, code }), code).toBe("terminal");
    }
  });
});

describe("kunciAlasanNotaSpg", () => {
  it("uses the code's own reason when it has one and a generic one otherwise", () => {
    expect(kunciAlasanNotaSpg("WAKTU_TIDAK_VALID")).toBe("WAKTU_TIDAK_VALID");
    expect(kunciAlasanNotaSpg("KODE_BARU_DARI_SERVER")).toBe("UMUM");
    expect(kunciAlasanNotaSpg(undefined)).toBe("UMUM");
  });
});

describe("bagianBisaDibuang", () => {
  it("offers to drop the SPG discount when the discount is what was rejected", () => {
    for (const kode of ["DISKON_MANUAL_NONAKTIF", "DISKON_MANUAL_LEWAT_BATAS", "DISKON_MANUAL_TIDAK_VALID", "ALASAN_DISKON_WAJIB"]) {
      expect(bagianBisaDibuang(kode), kode).toBe("diskon");
    }
  });

  it("offers to drop the shopper when the shopper is what was rejected", () => {
    expect(bagianBisaDibuang("PELANGGAN_TIDAK_VALID")).toBe("pembeli");
  });

  it("offers nothing for rejections that dropping a part cannot fix", () => {
    for (const kode of ["NO_PRICE", "WAKTU_TIDAK_VALID", "KUNJUNGAN_TIDAK_SAH", "FORBIDDEN", undefined]) {
      expect(bagianBisaDibuang(kode), String(kode)).toBeNull();
    }
  });
});

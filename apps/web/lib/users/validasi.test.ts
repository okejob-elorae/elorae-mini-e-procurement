import { describe, expect, it } from "vitest";
import { perannyaSpg, rapikanEmail, validasiPengguna } from "./validasi";

const DASAR = { nama: "Rina", email: "rina@toko.com", sandi: "rahasia123", ulangSandi: "rahasia123", butuhToko: false, tokoId: null };

describe("validasiPengguna", () => {
  it("accepts a complete new account", () => {
    expect(validasiPengguna({ ...DASAR, baru: true })).toEqual([]);
  });

  it("requires a name and a real-looking email", () => {
    expect(validasiPengguna({ ...DASAR, baru: true, nama: "  " })).toContain("NAMA_WAJIB");
    expect(validasiPengguna({ ...DASAR, baru: true, email: "bukan-email" })).toContain("EMAIL_TIDAK_VALID");
  });

  it("requires a password of at least 8 characters, typed twice the same, for a new account", () => {
    expect(validasiPengguna({ ...DASAR, baru: true, sandi: "", ulangSandi: "" })).toContain("SANDI_WAJIB");
    expect(validasiPengguna({ ...DASAR, baru: true, sandi: "pendek", ulangSandi: "pendek" })).toContain("SANDI_PENDEK");
    expect(validasiPengguna({ ...DASAR, baru: true, ulangSandi: "rahasia124" })).toContain("SANDI_TIDAK_SAMA");
  });

  it("lets an edit keep the old password by leaving it blank, but checks a new one", () => {
    expect(validasiPengguna({ ...DASAR, baru: false, sandi: "", ulangSandi: "" })).toEqual([]);
    expect(validasiPengguna({ ...DASAR, baru: false, sandi: "pendek", ulangSandi: "pendek" })).toContain("SANDI_PENDEK");
  });

  it("requires a fixed store for an SPG role", () => {
    expect(validasiPengguna({ ...DASAR, baru: true, butuhToko: true, tokoId: null })).toContain("TOKO_WAJIB");
    expect(validasiPengguna({ ...DASAR, baru: true, butuhToko: true, tokoId: "t1" })).toEqual([]);
  });
});

describe("rapikanEmail", () => {
  it("trims and lower-cases so the same person cannot get two accounts by capitalisation", () => {
    expect(rapikanEmail("  Rina@Toko.COM ")).toBe("rina@toko.com");
  });
});

describe("perannyaSpg", () => {
  it("treats a role that can record SPG sales as an SPG role, whatever its name", () => {
    expect(perannyaSpg(["pwa:access", "spg_sales:record"])).toBe(true);
    expect(perannyaSpg(["pwa:access", "field_sales_orders:create"])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  bacaSaluranJual,
  centangDariSaluran,
  dijualDiMarketplace,
  dijualOffline,
  saluranDariCentang,
  SALURAN_JUAL,
  syaratDijualOffline,
} from "./saluran-jual";

/* Jawaban pemilik P3/P3a (2026-11-02): dua centang — Marketplace, Toko offline, atau keduanya. */
describe("saluran jual", () => {
  it("centang ↔ saluran bolak-balik", () => {
    for (const s of SALURAN_JUAL) expect(saluranDariCentang(centangDariSaluran(s))).toBe(s);
  });

  it("tidak ada yang dicentang → null (wajib pilih)", () => {
    expect(saluranDariCentang({ marketplace: false, offline: false })).toBeNull();
    expect(centangDariSaluran(null)).toEqual({ marketplace: false, offline: false });
  });

  it("pembaca menolak isian asing", () => {
    expect(bacaSaluranJual("BOTH")).toBe("BOTH");
    for (const asing of ["both", "", null, undefined, 1, "KEDUANYA"]) expect(bacaSaluranJual(asing)).toBeNull();
  });

  it("marketplace dan offline", () => {
    expect([dijualDiMarketplace("MARKETPLACE"), dijualDiMarketplace("BOTH"), dijualDiMarketplace("OFFLINE")]).toEqual([true, true, false]);
    expect([dijualOffline("MARKETPLACE"), dijualOffline("BOTH"), dijualOffline("OFFLINE")]).toEqual([false, true, true]);
  });

  it("saringan pemilih offline menyembunyikan Marketplace saja", () => {
    expect(syaratDijualOffline()).toEqual({ salesChannel: { in: ["OFFLINE", "BOTH"] } });
  });
});

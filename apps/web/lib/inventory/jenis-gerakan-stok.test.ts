import { describe, expect, it } from "vitest";
import { STOCK_ADJUSTMENT_SOURCES } from "@elorae/db";
import { SUMBER_STOK_TUKAR } from "@/lib/salesman/tukar-barang";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import {
  REF_GERAKAN_STOK,
  SUMBER_MANUAL,
  SUMBER_OTOMATIS,
  SUMBER_PENYESUAIAN,
  labelJenisGerakan,
  whereSaringanSumber,
} from "./jenis-gerakan-stok";

describe("sumber penyesuaian", () => {
  it("mencakup seluruh registri sumber di @elorae/db dan sumber tukar barang", () => {
    for (const s of STOCK_ADJUSTMENT_SOURCES) expect(SUMBER_PENYESUAIAN).toContain(s);
    expect(SUMBER_PENYESUAIAN).toContain(SUMBER_STOK_TUKAR.MASUK);
    expect(SUMBER_PENYESUAIAN).toContain(SUMBER_STOK_TUKAR.KELUAR);
  });

  it("webhook Jubelio dan penjualan marketplace termasuk otomatis; manual dan opname tidak", () => {
    expect(SUMBER_OTOMATIS).toContain("JUBELIO_WEBHOOK");
    expect(SUMBER_OTOMATIS).toContain("FULFILLMENT_CONSUME");
    expect(SUMBER_OTOMATIS).toContain("KONSI_TRANSFER");
    for (const s of SUMBER_MANUAL) expect(SUMBER_OTOMATIS).not.toContain(s);
  });

  it("saringan bawaan menyembunyikan sumber otomatis (daftar hitam, sumber baru tetap tampil)", () => {
    expect(whereSaringanSumber()).toEqual({ source: { notIn: [...SUMBER_OTOMATIS] } });
    expect(whereSaringanSumber("manual")).toEqual(whereSaringanSumber());
    expect(whereSaringanSumber("semua")).toEqual({});
    expect(whereSaringanSumber("otomatis")).toEqual({ source: { in: [...SUMBER_OTOMATIS] } });
    expect(whereSaringanSumber("VAN_LOAD")).toEqual({ source: "VAN_LOAD" });
    // Isian aneh jatuh ke bawaan, tidak diteruskan apa adanya.
    expect(whereSaringanSumber("van_load'; --")).toEqual(whereSaringanSumber());
  });
});

describe("labelJenisGerakan", () => {
  const kamus: Record<string, string> = { FULFILLMENT_CONSUME: "Penjualan marketplace dikirim" };
  const t = Object.assign((k: string) => kamus[k] ?? k, { has: (k: string) => k in kamus });

  it("memakai label i18n bila ada, ejaan manusiawi bila belum", () => {
    expect(labelJenisGerakan(t, "FULFILLMENT_CONSUME")).toBe("Penjualan marketplace dikirim");
    expect(labelJenisGerakan(t, "SUMBER_BARU_NANTI")).toBe("Sumber baru nanti");
    expect(labelJenisGerakan(t, "")).toBe("");
  });

  // Label hidup di id.json/en.json (fragmen i18n tahap ini); berjalan begitu namespace-nya ada.
  const nsId = (id as { inventory: Record<string, unknown> }).inventory.stockMoveKind as Record<string, string> | undefined;
  const nsEn = (en as { inventory: Record<string, unknown> }).inventory.stockMoveKind as Record<string, string> | undefined;
  it.runIf(nsId != null && nsEn != null)("setiap kode punya label di kedua bahasa", () => {
    for (const kode of [...REF_GERAKAN_STOK, ...SUMBER_PENYESUAIAN]) {
      expect(nsId?.[kode], `id ${kode}`).toBeTruthy();
      expect(nsEn?.[kode], `en ${kode}`).toBeTruthy();
    }
  });
});

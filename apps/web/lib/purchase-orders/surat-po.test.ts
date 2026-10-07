import { describe, expect, it } from "vitest";
import { MAKS_PANJANG_SURAT_PO, SURAT_PO_BAWAAN, bacaSuratPo, periksaSuratPo } from "./surat-po";

describe("bacaSuratPo", () => {
  it("tidak ada atau rusak → bawaan (bahasa Indonesia)", () => {
    expect(bacaSuratPo(null)).toEqual(SURAT_PO_BAWAAN);
    expect(bacaSuratPo("{bukan json")).toEqual(SURAT_PO_BAWAAN);
    expect(bacaSuratPo("[1,2]")).toEqual(SURAT_PO_BAWAAN);
    expect(SURAT_PO_BAWAAN.pembuka).toMatch(/^Dengan hormat/);
  });

  it("satu bagian hilang diisi bawaan; teks kosong tersimpan tetap kosong (tidak dicetak)", () => {
    expect(bacaSuratPo(JSON.stringify({ pembuka: "Halo" }))).toEqual({ pembuka: "Halo", penutup: SURAT_PO_BAWAAN.penutup });
    expect(bacaSuratPo(JSON.stringify({ pembuka: "", penutup: " Terima kasih \r\n" }))).toEqual({ pembuka: "", penutup: "Terima kasih" });
  });
});

describe("periksaSuratPo", () => {
  it("merapikan dan menerima teks sampai batasnya", () => {
    expect(periksaSuratPo({ pembuka: " A\r\nB ", penutup: "" })).toEqual({ pembuka: "A\nB", penutup: "" });
    expect(periksaSuratPo({ pembuka: "x".repeat(MAKS_PANJANG_SURAT_PO), penutup: "y" })).not.toBeNull();
  });

  it("menolak bentuk lain atau teks terlalu panjang", () => {
    expect(periksaSuratPo(null)).toBeNull();
    expect(periksaSuratPo({ pembuka: 1, penutup: "" })).toBeNull();
    expect(periksaSuratPo({ pembuka: "a" })).toBeNull();
    expect(periksaSuratPo({ pembuka: "x".repeat(MAKS_PANJANG_SURAT_PO + 1), penutup: "" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { PROFIL_PAJAK_BAWAAN, bacaProfilPajakMentah, pakaiPphFinalUmkm } from "./profil";

describe("profil pajak (SystemSetting pajak.profil)", () => {
  it("bawaan: bentuk usaha dan rezim PPh belum ditetapkan", () => {
    expect(PROFIL_PAJAK_BAWAAN).toEqual({ bentukUsaha: "BELUM_DITETAPKAN", rezimPph: "BELUM_DITETAPKAN", sejak: null });
    for (const v of [null, undefined, "", "rusak", 7, "[]"]) expect(bacaProfilPajakMentah(v)).toEqual(PROFIL_PAJAK_BAWAAN);
    expect(pakaiPphFinalUmkm(PROFIL_PAJAK_BAWAAN)).toBe(false);
  });

  it("membaca teks JSON; nilai tidak dikenal jatuh ke bawaan per kunci", () => {
    expect(bacaProfilPajakMentah(JSON.stringify({ bentukUsaha: "CV", rezimPph: "FINAL_UMKM", sejak: "2026-04-22" }))).toEqual({
      bentukUsaha: "CV",
      rezimPph: "FINAL_UMKM",
      sejak: "2026-04-22",
    });
    expect(bacaProfilPajakMentah({ bentukUsaha: "FIRMA", rezimPph: "NORMAL_31E", sejak: "2026-13-01" })).toEqual({
      bentukUsaha: "BELUM_DITETAPKAN",
      rezimPph: "NORMAL_31E",
      sejak: null,
    });
    expect(pakaiPphFinalUmkm(bacaProfilPajakMentah({ rezimPph: "FINAL_UMKM" }))).toBe(true);
  });
});

describe("periksaProfilPajak (ketat, untuk menyimpan)", () => {
  it("menerima profil sah dan menolak isian rusak", async () => {
    const { periksaProfilPajak, finalUmkmPerluDicek } = await import("./profil");
    expect(periksaProfilPajak({ bentukUsaha: "PT_PERORANGAN", rezimPph: "FINAL_UMKM", sejak: "" })).toEqual({
      ok: true,
      profil: { bentukUsaha: "PT_PERORANGAN", rezimPph: "FINAL_UMKM", sejak: null },
    });
    expect(periksaProfilPajak({ bentukUsaha: "CV", rezimPph: "NORMAL", sejak: "2026-02-30" })).toEqual({ ok: false, galat: "TANGGAL_TIDAK_SAH" });
    expect(periksaProfilPajak({ bentukUsaha: "FIRMA", rezimPph: "NORMAL" })).toEqual({ ok: false, galat: "BENTUK_TIDAK_SAH" });
    expect(periksaProfilPajak({ bentukUsaha: "CV", rezimPph: "X" })).toEqual({ ok: false, galat: "REZIM_TIDAK_SAH" });
    expect(finalUmkmPerluDicek({ bentukUsaha: "CV", rezimPph: "FINAL_UMKM", sejak: null })).toBe(true);
    expect(finalUmkmPerluDicek({ bentukUsaha: "KOPERASI", rezimPph: "FINAL_UMKM", sejak: null })).toBe(false);
  });
});

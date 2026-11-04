import { describe, expect, it } from "vitest";
import { aksiJurnalManual, alasanJurnalCukup, barisPembalik, jenisBolehDibalik } from "./aturan";

const dasar = {
  status: "DRAFT",
  isManual: true,
  sourceType: null,
  pembuatId: "a",
  penontonId: "b",
  bolehMengelola: true,
  adaPembalik: false,
  adalahPembalik: false,
};

describe("tombol jurnal manual (maker-checker)", () => {
  it("orang lain: setujui dan tolak; pembuat: tarik dan ubah, tidak pernah setujui", () => {
    expect(aksiJurnalManual(dasar)).toMatchObject({ setujui: true, tolak: true, tarik: false, ubah: false, balik: false, alasanTidakBisaSetujui: null });
    expect(aksiJurnalManual({ ...dasar, penontonId: "a" })).toMatchObject({ setujui: false, tolak: false, tarik: true, ubah: true, alasanTidakBisaSetujui: "PEMBUAT_SAMA" });
  });

  it("draf pembalik tidak bisa diubah; tanpa izin mengelola tidak ada tombol", () => {
    expect(aksiJurnalManual({ ...dasar, penontonId: "a", adalahPembalik: true }).ubah).toBe(false);
    expect(aksiJurnalManual({ ...dasar, bolehMengelola: false })).toMatchObject({ setujui: false, tolak: false, tarik: false, ubah: false, balik: false });
  });

  it("balik: hanya jurnal manual / berulang yang sudah diposting dan belum dibalik", () => {
    expect(aksiJurnalManual({ ...dasar, status: "POSTED" }).balik).toBe(true);
    expect(aksiJurnalManual({ ...dasar, status: "POSTED", adaPembalik: true }).balik).toBe(false);
    expect(aksiJurnalManual({ ...dasar, status: "POSTED", isManual: false, sourceType: "RECURRING" }).balik).toBe(true);
    expect(aksiJurnalManual({ ...dasar, status: "POSTED", isManual: false, sourceType: "GRN" }).balik).toBe(false);
    expect(aksiJurnalManual({ ...dasar, status: "REJECTED" }).balik).toBe(false);
    expect(jenisBolehDibalik({ isManual: false, sourceType: null })).toBe(false);
  });

  it("baris pembalik menukar debit dan kredit, memo dan kanal tetap", () => {
    expect(barisPembalik([{ chartAccountId: "x", debit: 5, credit: 0, memo: "m", channel: "KOL", storeId: null }])).toEqual([
      { chartAccountId: "x", debit: 0, credit: 5, memo: "m", channel: "KOL", storeId: null },
    ]);
  });

  it("alasan minimal lima karakter", () => {
    expect(alasanJurnalCukup("abcd")).toBe(false);
    expect(alasanJurnalCukup(" abcde ")).toBe(true);
    expect(alasanJurnalCukup(null)).toBe(false);
  });
});

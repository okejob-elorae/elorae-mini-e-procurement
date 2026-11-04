import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { grnBolehDiretur } from "./pilihan-grn";

// GRN tanpa PO yang menunggu konfirmasi admin belum diproses (P51a): aksi retur menolaknya
// (`GRN_BELUM_DIPROSES`), jadi formulir tidak boleh menawarkannya.

const berPo = { id: "g-po", docNumber: "GRN/1", requiresNoPoConfirmation: false, noPoConfirmedAt: null };
const menunggu = { id: "g-tunggu", docNumber: "GRN/2", requiresNoPoConfirmation: true, noPoConfirmedAt: null };
const dikonfirmasi = {
  id: "g-ok",
  docNumber: "GRN/3",
  requiresNoPoConfirmation: true,
  noPoConfirmedAt: "2026-11-03T02:00:00.000Z",
};

describe("pilihan GRN retur ke pemasok", () => {
  it("menyembunyikan GRN tanpa PO yang masih menunggu, sisanya tetap berurutan", () => {
    expect(grnBolehDiretur([berPo, menunggu, dikonfirmasi])).toEqual([berPo, dikonfirmasi]);
  });

  it("GRN yang sudah terpilih di draf tetap tampil walau masih menunggu", () => {
    expect(grnBolehDiretur([berPo, menunggu], "g-tunggu")).toEqual([berPo, menunggu]);
    expect(grnBolehDiretur([berPo, menunggu], "")).toEqual([berPo]);
    expect(grnBolehDiretur([berPo, menunggu], null)).toEqual([berPo]);
  });

  it("formulir baru dan formulir ubah sama-sama menyaring daftar GRN-nya", () => {
    const baca = (...p: string[]) => readFileSync(path.join(__dirname, ...p), "utf8");
    expect(baca("new", "page.tsx")).toMatch(/grnBolehDiretur\(\s*grnList/);
    expect(baca("[id]", "edit", "page.tsx")).toMatch(/grnBolehDiretur\(\s*grnList[\s\S]*retGrnId/);
  });
});

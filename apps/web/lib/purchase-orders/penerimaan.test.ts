import { describe, expect, it } from "vitest";
import { alasanTolakPenerimaanPo } from "./penerimaan";

/*
 * Status PO yang boleh menerima GRN. PO yang sudah ditutup (lengkap atau lewat
 * "Tutup PO") tidak boleh menerima barang lagi: GRN berikutnya akan menghitung
 * ulang status dan membuka kembali PO yang sudah ditutup.
 */
describe("alasanTolakPenerimaanPo", () => {
  it.each([
    ["DRAFT", "PO_BELUM_DISETUJUI"],
    ["CANCELLED", "PO_DIBATALKAN"],
    ["CLOSED", "PO_DITUTUP"],
  ] as const)("%s ditolak dengan %s", (status, kode) => {
    expect(alasanTolakPenerimaanPo(status)).toBe(kode);
  });

  it.each(["SUBMITTED", "PARTIAL", "OVER"] as const)("%s boleh menerima barang", (status) => {
    expect(alasanTolakPenerimaanPo(status)).toBeNull();
  });
});

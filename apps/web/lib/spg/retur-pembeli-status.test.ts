import { describe, expect, it } from "vitest";
import {
  KEADAAN_UANG_RETUR,
  STATUS_RETUR_PEMBELI,
  UKURAN_HALAMAN_RETUR_PEMBELI,
  bacaSaringanReturPembeli,
  bacaStatusReturPembeli,
  keadaanUangRetur,
  returPembeliSudahBerlaku,
  sisaReturPembeli,
  uangReturTercatat,
} from "./retur-pembeli-status";

describe("status retur pembeli", () => {
  it("knows exactly the four statuses and nothing else", () => {
    expect(STATUS_RETUR_PEMBELI).toEqual(["MENUNGGU", "DISETUJUI", "DITOLAK", "DIBATALKAN"]);
    for (const s of STATUS_RETUR_PEMBELI) expect(bacaStatusReturPembeli(s)).toBe(s);
    expect(bacaStatusReturPembeli("disetujui")).toBeNull();
    expect(bacaStatusReturPembeli("SEMUA")).toBeNull();
    expect(bacaStatusReturPembeli(null)).toBeNull();
    expect(bacaStatusReturPembeli(3)).toBeNull();
  });

  it("only an approved report is in effect", () => {
    expect(returPembeliSudahBerlaku("DISETUJUI")).toBe(true);
    for (const s of ["MENUNGGU", "DITOLAK", "DIBATALKAN", "", "APPROVED"]) expect(returPembeliSudahBerlaku(s)).toBe(false);
  });

  it("what can still be reported = sold − approved − pending, never below zero", () => {
    expect(sisaReturPembeli({ qty: 5, returnedQty: 1, menunggu: 2 })).toBe(2);
    expect(sisaReturPembeli({ qty: 3, returnedQty: 0, menunggu: 3 })).toBe(0);
    // Data lama yang tidak masuk akal (mis. tulisan jendela penerapan) tetap tidak negatif.
    expect(sisaReturPembeli({ qty: 2, returnedQty: 2, menunggu: 1 })).toBe(0);
  });

  it("pieces held by a charged rejection are not reportable again", () => {
    expect(sisaReturPembeli({ qty: 5, returnedQty: 1, menunggu: 1, ditahan: 2 })).toBe(1);
    expect(sisaReturPembeli({ qty: 3, returnedQty: 0, menunggu: 0, ditahan: 3 })).toBe(0);
    expect(sisaReturPembeli({ qty: 3, returnedQty: 0, menunggu: 0, ditahan: 9 })).toBe(0);
  });
});

describe("uang retur pembeli", () => {
  it("money counts as refunded when the SPG recorded it OR the office marked it at rejection (P78)", () => {
    expect(uangReturTercatat({ refundedAt: null, refundMarkedById: null })).toBe(false);
    expect(uangReturTercatat({ refundedAt: new Date(), refundMarkedById: null })).toBe(true);
    expect(uangReturTercatat({ refundedAt: "2026-11-02T03:00:00.000Z", refundMarkedById: null })).toBe(true);
    expect(uangReturTercatat({ refundedAt: null, refundMarkedById: "kantor" })).toBe(true);
  });

  it("derives all seven money states from status × refunded", () => {
    const semua = STATUS_RETUR_PEMBELI.flatMap((status) => [false, true].map((uangTercatat) => keadaanUangRetur({ status, uangTercatat })));
    expect(new Set(semua)).toEqual(new Set(KEADAAN_UANG_RETUR));
    expect(keadaanUangRetur({ status: "MENUNGGU", uangTercatat: false })).toBe("MENUNGGU_BELUM");
    expect(keadaanUangRetur({ status: "MENUNGGU", uangTercatat: true })).toBe("MENUNGGU_SUDAH");
    expect(keadaanUangRetur({ status: "DISETUJUI", uangTercatat: false })).toBe("SILAKAN_KEMBALIKAN");
    expect(keadaanUangRetur({ status: "DISETUJUI", uangTercatat: true })).toBe("SUDAH_DIKEMBALIKAN");
    // P83: ditolak tanpa uang dikembalikan → jangan kembalikan; barangnya kembali ke pembeli.
    expect(keadaanUangRetur({ status: "DITOLAK", uangTercatat: false })).toBe("JANGAN_KEMBALIKAN");
    expect(keadaanUangRetur({ status: "DITOLAK", uangTercatat: true })).toBe("DIBEBANKAN");
    expect(keadaanUangRetur({ status: "DIBATALKAN", uangTercatat: false })).toBe("DITARIK");
  });
});

describe("bacaSaringanReturPembeli", () => {
  it("defaults to the Menunggu tab, page 1, every store", () => {
    expect(bacaSaringanReturPembeli({})).toEqual({ status: "MENUNGGU", storeId: null, cari: "", halaman: 1, ukuran: UKURAN_HALAMAN_RETUR_PEMBELI });
  });

  it("reads a known status, SEMUA, KEPUTUSAN_BARANG, and falls back to MENUNGGU for anything else", () => {
    expect(bacaSaringanReturPembeli({ status: "DITOLAK" }).status).toBe("DITOLAK");
    expect(bacaSaringanReturPembeli({ status: "semua" }).status).toBe("SEMUA");
    expect(bacaSaringanReturPembeli({ status: "keputusan_barang" }).status).toBe("KEPUTUSAN_BARANG");
    expect(bacaSaringanReturPembeli({ status: "dibatalkan" }).status).toBe("DIBATALKAN");
    expect(bacaSaringanReturPembeli({ status: "HAPUS" }).status).toBe("MENUNGGU");
  });

  it("takes the first of repeated params, trims and bounds them, and never a page below 1", () => {
    const s = bacaSaringanReturPembeli({ status: ["DISETUJUI", "DITOLAK"], toko: [" t1 ", "t2"], cari: ["  SPG/1  "], halaman: ["3"] });
    expect(s).toMatchObject({ status: "DISETUJUI", storeId: "t1", cari: "SPG/1", halaman: 3 });
    expect(bacaSaringanReturPembeli({ halaman: "0" }).halaman).toBe(1);
    expect(bacaSaringanReturPembeli({ halaman: "-4" }).halaman).toBe(1);
    expect(bacaSaringanReturPembeli({ halaman: "abc" }).halaman).toBe(1);
    expect(bacaSaringanReturPembeli({ cari: "x".repeat(200) }).cari).toHaveLength(64);
    expect(bacaSaringanReturPembeli({ toko: "  " }).storeId).toBeNull();
  });
});

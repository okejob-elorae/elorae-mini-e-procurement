import { describe, expect, it } from "vitest";
import {
  STATUS_RETUR_PEMBELI,
  UKURAN_HALAMAN_RETUR_PEMBELI,
  bacaSaringanReturPembeli,
  bacaStatusReturPembeli,
  returPembeliSudahBerlaku,
  sisaReturPembeli,
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
});

describe("bacaSaringanReturPembeli", () => {
  it("defaults to the Menunggu tab, page 1, every store", () => {
    expect(bacaSaringanReturPembeli({})).toEqual({ status: "MENUNGGU", storeId: null, cari: "", halaman: 1, ukuran: UKURAN_HALAMAN_RETUR_PEMBELI });
  });

  it("reads a known status, SEMUA, and falls back to MENUNGGU for anything else", () => {
    expect(bacaSaringanReturPembeli({ status: "DITOLAK" }).status).toBe("DITOLAK");
    expect(bacaSaringanReturPembeli({ status: "semua" }).status).toBe("SEMUA");
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

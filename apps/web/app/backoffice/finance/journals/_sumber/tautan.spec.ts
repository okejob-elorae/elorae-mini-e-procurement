import { describe, expect, it } from "vitest";
import {
  JENIS_SUMBER_JURNAL,
  idDokumenDariSumber,
  kunciDokumen,
  rentangBulanWib,
  saringanSumber,
  tautanBukuBesar,
  tautanDokumenSumber,
} from "./tautan";

/*
 * Penelusuran jurnal → dokumen sumbernya. Setiap jenis sumber jurnal otomatis
 * harus menunjuk ke halaman yang benar-benar ada; jenis yang tidak dikenal
 * tidak boleh menebak alamat.
 */

describe("idDokumenDariSumber", () => {
  it("pembayaran pemasok ber-sourceId `poId#generasi` → id PO", () => {
    expect(idDokumenDariSumber("SUPPLIER_PAYMENT", "po1#2")).toBe("po1");
    expect(idDokumenDariSumber("SUPPLIER_PAYMENT_REVERSAL", "po1#1")).toBe("po1");
  });

  it("jenis lain memakai sourceId apa adanya; kosong → null", () => {
    expect(idDokumenDariSumber("GRN", "g#1")).toBe("g#1");
    expect(idDokumenDariSumber("OPNAME", "")).toBeNull();
    expect(idDokumenDariSumber(null, "x")).toBeNull();
    expect(idDokumenDariSumber("SUPPLIER_PAYMENT", "#1")).toBeNull();
  });
});

describe("tautanDokumenSumber", () => {
  it("setiap jenis sumber jurnal otomatis menuju halamannya", () => {
    expect(tautanDokumenSumber("SETTLEMENT", "s1")).toBe("/backoffice/finance/settlements/s1");
    expect(tautanDokumenSumber("OPNAME", "o1")).toBe("/backoffice/inventory/stock-opname/o1");
    expect(tautanDokumenSumber("SALESORDER_REVENUE", "so1")).toBe("/backoffice/sales-orders/so1");
    expect(tautanDokumenSumber("SALESORDER_COGS", "so1")).toBe("/backoffice/sales-orders/so1");
    expect(tautanDokumenSumber("SALESRETURN_REVENUE", "r1")).toBe("/backoffice/returns/r1");
    expect(tautanDokumenSumber("SALESRETURN_COGS", "r1")).toBe("/backoffice/returns/r1");
    expect(tautanDokumenSumber("VAN_SALE", "v1")).toBe("/backoffice/van-sales/v1");
    expect(tautanDokumenSumber("VAN_RECONCILE", "v2")).toBe("/backoffice/canvassing/reconcile/v2");
    expect(tautanDokumenSumber("SUPPLIER_PAYMENT", "po1")).toBe("/backoffice/purchase-orders/po1");
    expect(tautanDokumenSumber("SUPPLIER_PAYMENT_REVERSAL", "po1")).toBe("/backoffice/purchase-orders/po1");
  });

  it("dokumen tanpa halaman sendiri menuju induknya bila diketahui, kalau tidak ke daftarnya", () => {
    expect(tautanDokumenSumber("GRN", "g1", { poId: "po9" })).toBe("/backoffice/purchase-orders/po9");
    expect(tautanDokumenSumber("GRN_REVERSAL", "g1", { poId: null })).toBe("/backoffice/inventory?tab=grn");
    expect(tautanDokumenSumber("FG_RECEIPT", "r1", { woId: "wo1" })).toBe("/backoffice/work-orders/wo1");
    expect(tautanDokumenSumber("FG_RECEIPT", "r1")).toBe("/backoffice/work-orders");
    expect(tautanDokumenSumber("VAN_LOAD", "l1", { canvasserId: "c1" })).toBe("/backoffice/canvassing/c1");
    expect(tautanDokumenSumber("VAN_LOAD", "l1")).toBe("/backoffice/canvassing");
  });

  it("id di-encode; jenis tidak dikenal atau id kosong → null", () => {
    expect(tautanDokumenSumber("OPNAME", "a/b c")).toBe("/backoffice/inventory/stock-opname/a%2Fb%20c");
    expect(tautanDokumenSumber("ENTAH", "x")).toBeNull();
    expect(tautanDokumenSumber(null, "x")).toBeNull();
    expect(tautanDokumenSumber("OPNAME", "")).toBeNull();
  });
});

describe("kunciDokumen", () => {
  it("menggabungkan jenis dan id", () => {
    expect(kunciDokumen("GRN", "g1")).toBe("GRN|g1");
  });
});

describe("rentangBulanWib — buku besar akun pada bulan jurnalnya", () => {
  it("bulan kalender WIB dari tanggal jurnal", () => {
    // 31 Jan 18:00 UTC = 1 Feb 01:00 WIB → bulan Februari.
    expect(rentangBulanWib("2026-01-31T18:00:00.000Z")).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
    expect(rentangBulanWib("2028-02-10T03:00:00.000Z")).toEqual({ dari: "2028-02-01", sampai: "2028-02-29" });
    expect(rentangBulanWib("2026-12-15T03:00:00.000Z")).toEqual({ dari: "2026-12-01", sampai: "2026-12-31" });
  });

  it("tanggal rusak → null", () => {
    expect(rentangBulanWib("bukan tanggal")).toBeNull();
  });
});

describe("JENIS_SUMBER_JURNAL & saringanSumber", () => {
  it("setiap jenis sumber yang bisa disaring punya halaman dokumen", () => {
    for (const jenis of JENIS_SUMBER_JURNAL) {
      expect(tautanDokumenSumber(jenis, "x", { poId: "p", woId: "w", canvasserId: "c" })).not.toBeNull();
    }
  });

  it("manual, jenis dikenal, dan nilai asing", () => {
    expect(saringanSumber("manual")).toEqual({ manualOnly: true });
    expect(saringanSumber("GRN")).toEqual({ sourceType: "GRN" });
    expect(saringanSumber("DROP TABLE")).toEqual({});
    expect(saringanSumber(undefined)).toEqual({});
  });
});

describe("tautanBukuBesar — baris laporan & jurnal turun ke buku besar akun", () => {
  it("membawa periode yang sama; sejak awal → tanpa from", () => {
    expect(tautanBukuBesar("acc1", { dari: "2026-01-01", sampai: "2026-03-31" })).toBe(
      "/backoffice/finance/journals/ledger/acc1?from=2026-01-01&to=2026-03-31",
    );
    expect(tautanBukuBesar("acc1", { dari: null, sampai: "2026-10-06" })).toBe(
      "/backoffice/finance/journals/ledger/acc1?to=2026-10-06",
    );
    expect(tautanBukuBesar("a/b")).toBe("/backoffice/finance/journals/ledger/a%2Fb");
  });
});

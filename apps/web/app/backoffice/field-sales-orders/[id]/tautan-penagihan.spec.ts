import { describe, expect, it } from "vitest";
import { tautanFakturPajak, tautanPiutangFaktur } from "./tautan-penagihan";

describe("tautan penagihan dari rincian pesanan", () => {
  it("piutang dibuka lewat nomor fakturnya, bukan kelompok keadaan", () => {
    expect(tautanPiutangFaktur("INV/2026/0101")).toBe("/backoffice/piutang?cari=INV%2F2026%2F0101");
  });

  it("faktur pajak bernomor dicari nomornya; yang menunggu dicari nomor notanya", () => {
    expect(tautanFakturPajak({ status: "CREATED", invoiceNo: "010.000-26.00000001" }, "DLV/2026/12")).toBe(
      "/backoffice/finance/faktur-pajak?q=010.000-26.00000001",
    );
    expect(tautanFakturPajak({ status: "PENDING", invoiceNo: null }, "DLV/2026/12")).toBe(
      "/backoffice/finance/faktur-pajak?q=DLV%2F2026%2F12",
    );
  });

  it("tanpa faktur pajak atau 'dibuat' tanpa nomor → tidak bertaut (pencarian pasti kosong)", () => {
    expect(tautanFakturPajak(null, "DLV/2026/12")).toBeNull();
    expect(tautanFakturPajak({ status: "CREATED", invoiceNo: null }, "DLV/2026/12")).toBeNull();
    expect(tautanFakturPajak({ status: "CREATED", invoiceNo: "  " }, "DLV/2026/12")).toBeNull();
  });
});

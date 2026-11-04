import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receivables/queries", () => ({ daftarPiutang: vi.fn() }));

import { penagihanSesuaiIzin } from "./tautan-pesanan";

/*
 * Rincian pesanan lapangan dibuka siapa pun yang boleh melihat pesanan. Piutang dan faktur pajak
 * nota (nomor NSFP) hanya boleh sampai ke peramban yang boleh membuka halaman piutang / faktur pajak.
 */
const kiriman = [
  {
    id: "d1",
    docNo: "DLV/2026/0001",
    receivable: { id: "r1", invoiceNo: "DLV/2026/0001" },
    taxInvoice: { status: "CREATED" as const, invoiceNo: "010.000-26.00000001" },
  },
];

describe("penagihanSesuaiIzin", () => {
  it("tanpa izin piutang dan faktur pajak: keduanya tidak ikut ke peramban", () => {
    expect(penagihanSesuaiIzin(kiriman, { piutang: false, fakturPajak: false })).toEqual([
      { id: "d1", docNo: "DLV/2026/0001", receivable: null, taxInvoice: null },
    ]);
  });

  it("izin faktur pajak saja: nomor NSFP ikut, piutang tidak", () => {
    const [d] = penagihanSesuaiIzin(kiriman, { piutang: false, fakturPajak: true });
    expect(d.receivable).toBeNull();
    expect(d.taxInvoice).toEqual({ status: "CREATED", invoiceNo: "010.000-26.00000001" });
  });

  it("izin keduanya: data utuh, baris lain tidak berubah", () => {
    expect(penagihanSesuaiIzin(kiriman, { piutang: true, fakturPajak: true })).toEqual(kiriman);
  });
});

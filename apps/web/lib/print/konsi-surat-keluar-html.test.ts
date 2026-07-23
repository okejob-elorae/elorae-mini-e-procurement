import { describe, it, expect } from "vitest";
import { buildSuratKeluarPrintHtml } from "./konsi-surat-keluar-html";

const labels = {
  title: "SURAT KELUAR BARANG",
  doc: "No. Dokumen",
  store: "Toko",
  salesman: "Sales",
  date: "Tanggal",
  status: "Status",
  no: "No",
  product: "Produk",
  qty: "Qty",
  consignmentNote: "Konsinyasi — penyerahan barang titipan, bukan penjualan. Tanpa harga dan tanpa tagihan.",
  handedBy: "Diserahkan",
  receivedBy: "Diterima toko",
  issuedBy: "Diterbitkan oleh",
};

describe("buildSuratKeluarPrintHtml", () => {
  it("renders qty-only + consignment note + no price", () => {
    const html = buildSuratKeluarPrintHtml({
      orderNo: "KONSI/2607/0003",
      storeName: "Toko B",
      salesmanName: "Budi",
      approvedAt: "2026-07-20T00:00:00Z",
      status: "APPROVED",
      lines: [{ productName: "Celana", variantSku: "C-32", variantLabel: "size: 32", qty: 4 }],
      labels,
    });
    expect(html).toContain("SURAT KELUAR BARANG");
    expect(html).toContain("KONSI/2607/0003");
    expect(html).toContain("bukan penjualan");
    expect(html).not.toMatch(/Rp\s/);
  });
});

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

describe("buildSuratKeluarPrintHtml — surat jalan pengiriman berharga (P37)", () => {
  it("lists each article's unit price, value and the total like a nota; a line with no price prints —", () => {
    const html = buildSuratKeluarPrintHtml({
      orderNo: "DLV/2611/0001",
      storeName: "Toko B",
      salesmanName: "Budi",
      approvedAt: "2026-11-02T00:00:00Z",
      status: "Dikemas",
      lines: [
        { productName: "Celana", variantSku: "C-32", variantLabel: null, qty: 4, unitPrice: 150_000 },
        { productName: "Kaos", variantSku: "", variantLabel: null, qty: 2, unitPrice: null },
      ],
      labels: { ...labels, price: "Harga satuan", value: "Nilai", total: "Total nilai" },
    });
    expect(html).toContain("Harga satuan");
    expect(html).toContain("Nilai");
    expect(html).toContain("Total nilai");
    expect(html).toContain("Rp 150.000");
    expect(html).toContain("Rp 600.000");
    expect(html).toContain("—");
  });

  it("the legacy order-header print (no price on any line) has no price columns", () => {
    const html = buildSuratKeluarPrintHtml({
      orderNo: "KONSI/2607/0003",
      storeName: "Toko B",
      salesmanName: "Budi",
      approvedAt: "2026-07-20T00:00:00Z",
      status: "APPROVED",
      lines: [{ productName: "Celana", variantSku: "C-32", variantLabel: null, qty: 4 }],
      labels: { ...labels, price: "Harga satuan", value: "Nilai", total: "Total nilai" },
    });
    expect(html).not.toContain("Harga satuan");
  });
});

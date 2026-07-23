import { describe, it, expect } from "vitest";
import { buildNotaGudangPrintHtml } from "./field-sales-nota-gudang-html";

const labels = { title: "NOTA GUDANG", doc: "No. Dokumen", store: "Toko", salesman: "Sales", date: "Tanggal", status: "Status", no: "No", product: "Produk", qty: "Qty", preparedBy: "Disiapkan", receivedBy: "Diterima", issuedBy: "Diterbitkan oleh" };

describe("buildNotaGudangPrintHtml", () => {
  it("renders title, order no, qty and NO price", () => {
    const html = buildNotaGudangPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T00:00:00Z",
      status: "APPROVED",
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6 }],
      labels,
    });
    expect(html).toContain("NOTA GUDANG");
    expect(html).toContain("PUTUS/2607/0001");
    expect(html).toContain("size: M");
    expect(html).toContain(">6<");
    expect(html).not.toMatch(/Rp\s/); // warehouse copy carries no price
  });
});

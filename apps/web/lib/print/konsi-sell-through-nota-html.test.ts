import { describe, it, expect } from "vitest";
import { buildKonsiSellThroughNotaHtml } from "./konsi-sell-through-nota-html";

const labels = {
  title: "NOTA TAGIHAN KONSINYASI", doc: "No. Nota", store: "Toko", npwp: "NPWP", period: "Periode",
  periodFirst: "s.d.", date: "Tanggal", dueDate: "Jatuh tempo", salesman: "Sales", no: "No", product: "Produk",
  qty: "Qty", price: "Harga", lineTotal: "Jumlah", grandTotal: "Total", issuedBy: "Diterbitkan oleh",
  regards: "Hormat kami", receivedBy: "Diterima toko",
};

const base = {
  docNo: "SLT/2609/0001", storeName: "Toko <A&B>", storeAddress: "Jl. Test 1", storeNpwp: "01.234.567.8-901.000",
  periodStart: "2026-09-01T00:00:00+07:00", periodEnd: "2026-09-30T15:00:00+07:00",
  invoiceDate: "2026-10-01T00:00:00+07:00", dueDate: "2026-10-31T00:00:00+07:00", salesmanName: "Budi",
  lines: [{ productName: "Celana", variantLabel: "size: 32", variantSku: "C-32", billedQty: 3, unitPrice: 12501.25, lineTotal: 37503.75 }],
  total: 37503.75, labels,
};

describe("buildKonsiSellThroughNotaHtml", () => {
  it("returns a full document with the nota number, escaped store, NPWP and 2dp money", () => {
    const html = buildKonsiSellThroughNotaHtml(base);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("SLT/2609/0001");
    expect(html).toContain("Toko &lt;A&amp;B&gt;");
    expect(html).toContain("01.234.567.8-901.000");
    expect(html).toMatch(/Rp 12[.,]501[.,]25/);
    expect(html).toMatch(/Rp 37[.,]503[.,]75/);
    expect(html).toContain("size: 32");
  });

  it("renders a first report's period as up-to its end", () => {
    const html = buildKonsiSellThroughNotaHtml({ ...base, periodStart: null });
    expect(html).toContain("s.d.");
  });
});

import { describe, it, expect } from "vitest";
import { buildNotaTagihanPrintHtml } from "./field-sales-nota-tagihan-html";

const labels = { title: "NOTA TAGIHAN", doc: "No. Dokumen", store: "Toko", salesman: "Sales", date: "Tanggal", no: "No", product: "Produk", qty: "Qty", price: "Harga", discount: "Disc", lineTotal: "Subtotal", subtotal: "Subtotal", orderDiscount: "Diskon order", grandTotal: "Total", regards: "Hormat kami", receivedBy: "Penerima", issuedBy: "Diterbitkan oleh" };

describe("buildNotaTagihanPrintHtml", () => {
  it("renders prices, discount and grand total", () => {
    const html = buildNotaTagihanPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 5000, appliedOrderPromoName: "Promo Juli", total: 55000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("NOTA TAGIHAN");
    expect(html).toContain("Rp 10.000");
    expect(html).toContain("Rp 55.000"); // grand total
    expect(html).toContain("Promo Juli");
  });

  it("renders in landscape orientation", () => {
    const html = buildNotaTagihanPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("A4 landscape");
  });

  it("uses notaDate over approvedAt when provided", () => {
    const html = buildNotaTagihanPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T12:00:00Z",
      notaDate: "2026-08-15T12:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("AUG 15, 2026");
    expect(html).not.toContain("JUL 20, 2026");
  });

  it("renders an escaped footnote", () => {
    const html = buildNotaTagihanPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T00:00:00Z",
      footnote: "Barang tidak bisa <ditukar> & tidak diretur",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("Barang tidak bisa &lt;ditukar&gt; &amp; tidak diretur");
    expect(html).not.toContain("<ditukar>");
  });

  it("omits the footnote block when not provided", () => {
    const html = buildNotaTagihanPrintHtml({
      orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi", approvedAt: "2026-07-20T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    // The `.footnote` CSS rule is always emitted; assert the rendered DIV is not.
    expect(html).not.toContain('<div class="footnote">');
  });
});

import { describe, it, expect } from "vitest";
import { buildNotaTagihanPrintHtml } from "./field-sales-nota-tagihan-html";

const labels = { title: "NOTA TAGIHAN", doc: "No. Dokumen", orderRef: "Ref. Pesanan", store: "Toko", salesman: "Sales", date: "Tanggal", dueDate: "Jatuh Tempo", no: "No", product: "Produk", qty: "Qty", price: "Harga", discount: "Disc", lineTotal: "Subtotal", subtotal: "Subtotal", orderDiscount: "Diskon order", grandTotal: "Total", regards: "Hormat kami", receivedBy: "Penerima", issuedBy: "Diterbitkan oleh" };

describe("buildNotaTagihanPrintHtml", () => {
  it("renders prices, discount and grand total", () => {
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 5000, appliedOrderPromoName: "Promo Juli", total: 55000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("NOTA TAGIHAN");
    expect(html).toContain("Rp 10.000");
    expect(html).toContain("Rp 55.000"); /* grand total */
    expect(html).toContain("Promo Juli");
  });

  it("renders in landscape orientation", () => {
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("A4 landscape");
  });

  it("renders the delivery docNo and the order number", () => {
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("PTG/2607/0001");
    expect(html).toContain("PUTUS/2607/0001");
  });

  it("renders the stored invoice date and the due date", () => {
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T12:00:00Z", dueDate: "2026-08-19T12:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    expect(html).toContain("JUL 20, 2026");
    expect(html).toContain("AUG 19, 2026");
  });

  it("renders an escaped footnote", () => {
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
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
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
      subtotal: 60000, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 60000,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: 10000, lineTotal: 60000, discountAmount: 0, appliedPromoName: null }],
      labels,
    });
    /* The `.footnote` CSS rule is always emitted; assert the rendered DIV is not. */
    expect(html).not.toContain('<div class="footnote">');
  });

  it("renders an em dash in the price and line-total cells when they are null, never a zero-rupiah figure", () => {
    /*
     * Asserted on the CELLS, not on the document. `toContain("—")` is satisfied by the <title>
     * (`${title} — ${docNo}`) no matter what `idr()` does, and the pre-fix `idr` rendered null as
     * "Rp 0" — never the literal "null", never "NaN" — so a bare not-null / not-NaN pair passes
     * against the very bug it is supposed to guard. The real defect is an unknown price printing
     * as Rp 0 on a customer invoice.
     *
     * The discount is deliberately non-zero: with discountAmount 0 the discount cell legitimately
     * renders `Rp 0`, which would make the negative assertion below fail on correct code.
     */
    const html = buildNotaTagihanPrintHtml({
      docNo: "PTG/2607/0001", orderNo: "PUTUS/2607/0001", storeName: "Toko A", salesmanName: "Budi",
      invoiceDate: "2026-07-20T00:00:00Z", dueDate: "2026-08-19T00:00:00Z",
      subtotal: 0, orderDiscountAmount: 0, appliedOrderPromoName: null, total: 0,
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6, unitPrice: null, lineTotal: null, discountAmount: 500, appliedPromoName: null }],
      labels,
    });
    /* One for the unknown unit price, one for the unknown line total. */
    expect(html.match(/<td class="col-num">—<\/td>/g) ?? []).toHaveLength(2);
    /* The known figure on the same row still prints, so the em dashes are not a blanket blank-out. */
    expect(html).toContain('<td class="col-num">Rp 500</td>');
    expect(html).not.toContain('<td class="col-num">Rp 0</td>');
    /* `null - 500` coerces to -500, which is what the guard in lineNetTotal exists to prevent. */
    expect(html).not.toContain('<td class="col-num">Rp -500</td>');
  });
});

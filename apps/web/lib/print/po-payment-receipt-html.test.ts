import { describe, expect, it } from "vitest";
import { buildPOPaymentReceiptHtml } from "./po-payment-receipt-html";

/*
 * Bukti bayar pemasok dulu berlabel Inggris ("Receipt", "Amount paid") dengan
 * angka format peramban. Label bawaan dan angkanya kini Indonesia, tanggal WIB.
 */
describe("buildPOPaymentReceiptHtml", () => {
  const html = buildPOPaymentReceiptHtml({
    receiptNumber: "PR-PO-2026-0003",
    poDocNumber: "PO/2026/0003",
    supplierName: "Aksesoris Jaya",
    supplierCode: "SUP0002",
    paidAt: "2026-10-05T17:30:00.000Z",
    printedAt: "2026-10-06T03:00:00.000Z",
    currency: "IDR",
    amountPaid: 1_665_000,
  });

  it("label Indonesia bawaan", () => {
    expect(html).toContain("Bukti Pembayaran");
    expect(html).toContain("Jumlah dibayar");
    expect(html).not.toMatch(/Amount paid|Receipt No\.|Paid in full/);
  });

  it("angka dan tanggal Indonesia (WIB)", () => {
    expect(html).toContain("Rp 1.665.000");
    expect(html).toContain("6 Okt 2026");
  });
});

import { describe, expect, it } from "vitest";
import { buildVendorReturnPrintHtml } from "./vendor-return-html";

/*
 * Nota retur pemasok dulu mencetak label Inggris ("Doc", "Vendor", "Type"),
 * kode mentah (FABRIC, DAMAGED, PROCESSED), dan angka format peramban
 * ("125,000.00"). Sekarang Indonesia, tanggal WIB.
 */
describe("buildVendorReturnPrintHtml", () => {
  const html = buildVendorReturnPrintHtml({
    docNumber: "RET/2026/08/0002",
    vendorName: "PT Kain Indah",
    totalValue: 125_000,
    status: "PROCESSED",
    woDocNumber: "WO/2026/0005",
    poDocNumber: "PO/2026/0003",
    processedAt: "2026-10-05T17:30:00.000Z",
    lines: [
      { type: "FABRIC", itemId: "x", itemName: "Kain polyester", rollRef: "R-01", qty: 12.5, reason: "Cacat warna", condition: "DAMAGED", costValue: 125_000 },
      { type: "FG_REJECT", itemId: "y", itemName: "Kaos Eloraé", qty: 2, reason: "Jahitan lepas", condition: "DEFECTIVE", costValue: 0 },
    ],
  });

  it("label dan kode berbahasa Indonesia", () => {
    expect(html).toContain("Nota Retur");
    expect(html).toContain("Pemasok");
    expect(html).toContain("Perintah kerja");
    expect(html).toContain("PO/2026/0003");
    expect(html).toContain("Kain");
    expect(html).toContain("Rusak");
    expect(html).toContain("Diproses");
    expect(html).toContain("Sumber: stok reject");
    expect(html).not.toMatch(/>Doc<|>Vendor<|Source: Reject|>FABRIC<|>DAMAGED<|>PROCESSED</);
  });

  it("angka uang Indonesia", () => {
    expect(html).toContain("Rp 125.000");
    expect(html).not.toContain("125,000");
  });

  it("tanggal WIB", () => {
    expect(html).toContain("6 Okt 2026");
  });
});

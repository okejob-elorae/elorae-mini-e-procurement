import { describe, expect, it } from "vitest";
import { LABEL_CETAK_FAKTUR_PO, LABEL_CETAK_PO, buildPOPrintHtml, labelStatusCetakPo } from "./po-html";

/*
 * Cetak PO dulu seluruhnya berlabel Inggris ("Purchase Order", "PO Number",
 * status "Partial") dan angkanya berformat peramban (koma ribuan, ".00").
 * Dokumen ini dikirim ke pemasok lokal: label dan angka berbahasa Indonesia,
 * tanggal WIB.
 */
const dasar = {
  docNumber: "PO/2026/0003",
  issuedAt: "2026-10-05T17:30:00.000Z", // 6 Okt 2026, 00.30 WIB
  supplierName: "Aksesoris Jaya",
  supplierCode: "SUP0002",
  status: labelStatusCetakPo("PARTIAL"),
  etaDate: "2026-10-09T17:00:00.000Z", // 10 Okt 2026 WIB
  paymentDueDate: null,
  currency: "IDR",
  subtotal: 1_700_000,
  taxAmount: 187_000,
  grandTotal: 1_887_000,
  lines: [
    {
      itemName: "Kancing Eloraé",
      itemSku: "AC-001",
      variantSku: "AC-001-GLD",
      qty: 1500,
      uomCode: "PCS",
      price: 1133.33,
      amount: 1_699_995,
    },
  ],
};

describe("buildPOPrintHtml", () => {
  const html = buildPOPrintHtml(dasar);

  it("label Indonesia bawaan", () => {
    expect(html).toContain("Pesanan Pembelian");
    expect(html).toContain("No. PO");
    expect(html).toContain("Diterima sebagian");
    expect(html).not.toMatch(/Purchase Order|PO Number|Grand total|Unit price/);
  });

  it("angka uang dan qty berformat Indonesia", () => {
    expect(html).toContain("Rp 1.887.000");
    expect(html).toContain("Rp 1.133,33");
    expect(html).toContain("1.500");
    expect(html).not.toContain("1,887,000");
  });

  it("tanggal WIB berbahasa Indonesia", () => {
    expect(html).toContain("6 Okt 2026");
    expect(html).toContain("10 Okt 2026");
    expect(html).not.toMatch(/\bOCT \d|Oct 6/);
  });

  it("SKU varian berlabel Indonesia", () => {
    expect(html).toContain("SKU varian: AC-001-GLD");
    expect(html).not.toContain("Variant SKU");
  });

  it("faktur pembelian memakai labelnya sendiri", () => {
    const faktur = buildPOPrintHtml({ ...dasar, labels: LABEL_CETAK_FAKTUR_PO });
    expect(faktur).toContain("Faktur Pembelian");
    expect(LABEL_CETAK_PO.title).toBe("Pesanan Pembelian");
  });
});

describe("buildPOPrintHtml — surat dan rincian warna bahan", () => {
  const kain = {
    ...dasar,
    suratPembuka: "Dengan hormat,\nKami memesan kain <katun>:",
    suratPenutup: "Terima kasih.",
    lines: [
      { itemName: "Kain Katun", itemSku: "FAB-1", variantSku: "FAB-1-HITAM", qty: 60, uomCode: "KG", price: 50_000, amount: 3_000_000, warna: "HITAM · 19-4005 TCX", roll: 3 },
      { itemName: "Kain Katun", itemSku: "FAB-1", variantSku: "FAB-1-NAVY", qty: 40.5, uomCode: "KG", price: 50_000, amount: 2_025_000, warna: "NAVY", roll: 2 },
      { itemName: "Kancing", itemSku: "AC-1", qty: 100, uomCode: "PCS", price: 100, amount: 10_000 },
    ],
  };
  const html = buildPOPrintHtml(kain);

  it("paragraf pembuka sebelum tabel dan penutup sesudah total, teks di-escape, baris baru dipertahankan", () => {
    expect(html).toContain("Dengan hormat,\nKami memesan kain &lt;katun&gt;:");
    expect(html).toContain("white-space: pre-line");
    expect(html.indexOf("surat-pembuka")).toBeLessThan(html.indexOf('<table class="lines">'));
    expect(html.indexOf("Terima kasih.")).toBeGreaterThan(html.indexOf("grand-row"));
  });

  it("kolom Warna dan Roll tercetak bila ada barisnya; baris lain bertanda —", () => {
    expect(html).toContain("<th>Warna</th>");
    expect(html).toContain(">Roll</th>");
    expect(html).toContain("HITAM · 19-4005 TCX");
    expect(html).toContain("Total roll");
    expect(html).toMatch(/<span class="tv">5<\/span>/);
    expect(html).toContain("40,5");
  });

  it("PO tanpa warna, roll, dan surat tetap lima kolom tanpa paragraf", () => {
    const biasa = buildPOPrintHtml(dasar);
    expect(biasa).not.toContain("<th>Warna</th>");
    expect(biasa).not.toContain(">Roll</th>");
    expect(biasa).not.toContain('<section class="surat');
    expect(biasa).not.toContain("Total roll");
  });
});

describe("labelStatusCetakPo", () => {
  it("kode status → label Indonesia; kode tak dikenal apa adanya", () => {
    expect(labelStatusCetakPo("SUBMITTED")).toBe("Dikirim ke pemasok");
    expect(labelStatusCetakPo("OVER")).toBe("Lebih dari pesanan");
    expect(labelStatusCetakPo("ANEH")).toBe("ANEH");
  });
});

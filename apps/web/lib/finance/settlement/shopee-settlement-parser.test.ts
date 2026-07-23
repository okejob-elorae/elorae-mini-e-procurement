import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { parseShopeeSettlement } from "./shopee-settlement-parser";

const FIX = path.resolve(
  process.cwd(),
  "../../reference/finance/Income.sudah dilepas.id.20260601_20260630.xlsx",
);
const has = fs.existsSync(FIX);
const d = has ? describe : describe.skip;

d("parseShopeeSettlement (local fixture only)", () => {
  it("parses 4 sheets, income lines, summary total, and sums parsedNetTotal", () => {
    const res = parseShopeeSettlement(fs.readFileSync(FIX));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data;
    expect(d.seller).toContain("elorae");
    expect(d.incomeLines.length).toBeGreaterThan(50); // ~86 orders
    expect(d.summary.totalDilepas).not.toBe(0);
    // every income line has a non-empty orderNo + numeric netIncome
    expect(d.incomeLines.every((l) => l.orderNo.trim().length > 0 && Number.isFinite(l.netIncome))).toBe(true);
    // parsedNetTotal is the sum
    const sum = d.incomeLines.reduce((s, l) => s + l.netIncome, 0);
    expect(Math.round(d.parsedNetTotal)).toBe(Math.round(sum));
    expect(Array.isArray(d.sellerFeesRaw)).toBe(true);
    expect(Array.isArray(d.adjustmentsRaw)).toBe(true);
  });
});

const INCOME_HEADER = [
  "No. Pesanan",
  "Total Penghasilan",
  "Harga Asli Produk",
  "Total Diskon Produk",
  "Biaya Administrasi",
  "Biaya Layanan",
  "Biaya Komisi AMS",
  "Biaya Proses Pesanan",
];

function buildWorkbook(summaryRows: unknown[][]): Buffer {
  const incomeRows: unknown[][] = [
    INCOME_HEADER,
    ["260601AAA", 40000, 50000, 0, -5000, -3000, -2000, 0],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incomeRows), "Income");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Adjustment");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Seller Fee");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseShopeeSettlement (synthetic workbook)", () => {
  it("normalizes Date-typed Summary period cells to YYYY-MM-DD", () => {
    const buf = buildWorkbook([
      ["Username (Penjual)", "elorae.official"],
      ["Dari", new Date(Date.UTC(2026, 5, 1))],
      ["ke", new Date(Date.UTC(2026, 5, 30))],
      ["1. Total Pendapatan", 100000],
      ["2. Total Pengeluaran", 40000],
      ["3. Total yang Dilepas", 40000],
    ]);

    const res = parseShopeeSettlement(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.periodFrom).toBe("2026-06-01");
    expect(res.data.periodTo).toBe("2026-06-30");
    expect(res.data.seller).toBe("elorae.official");
  });

  it("returns ok:false when Summary anchors (seller/totalDilepas/period) are missing", () => {
    const buf = buildWorkbook([["Some Unrelated Label", "x"]]);

    const res = parseShopeeSettlement(buf);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.every((e) => e.sheet === "Summary")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateUmkmExcelByParent,
  excelSerialToDate,
  parseUmkmExcelDate,
} from "./umkm-excel-parse";

describe("parseUmkmExcelDate", () => {
  it("parses Excel serial numbers", () => {
    const d = parseUmkmExcelDate(45548);
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it("parses Indonesian text dates", () => {
    const d = parseUmkmExcelDate("06 Desember 2024");
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe("2024-12-06");
  });
});

describe("aggregateUmkmExcelByParent", () => {
  it("sums qty and sizes per parent up to cutoff", () => {
    const cutoff = new Date("2025-12-31T23:59:59Z");
    const rows = aggregateUmkmExcelByParent(
      [
        {
          parentKode: "27000008P",
          namaBarang: "CELANA",
          tgl: new Date("2024-12-06"),
          qty: 100,
          sizes: { S: 25, M: 25, L: 25, XL: 25 },
          label: "UMKM",
        },
        {
          parentKode: "27000008P",
          namaBarang: "CELANA",
          tgl: new Date("2025-01-06"),
          qty: 50,
          sizes: { S: 10, M: 10, L: 15, XL: 15 },
          label: "UMKM",
        },
      ],
      cutoff,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].parentKode).toBe("27000008P");
    expect(rows[0].excelQty).toBe(150);
    expect(rows[0].sizes).toEqual({ S: 35, M: 35, L: 40, XL: 40 });
  });
});

describe("excelSerialToDate", () => {
  it("converts excel serial to JS date", () => {
    const d = excelSerialToDate(45548);
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(8);
  });
});

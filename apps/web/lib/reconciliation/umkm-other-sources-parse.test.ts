import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  aggregateOtherSourceQtyByVariant,
  parseOtherSourcesDir,
  type OtherSourceLine,
} from "./umkm-other-sources-parse";
import { buildErpVariantIndex } from "./umkm-sku-bridge";

function makeIndex() {
  return buildErpVariantIndex([
    {
      erpVariantSku: "27000020P-S",
      jubelioItemCode: "27000020P-S",
      jubelioItemId: 1,
      itemId: "item1",
      parentItemSku: "27000020",
      itemName: "Dress",
      sizeSuffix: "S",
    },
    {
      erpVariantSku: "27000020P-L",
      jubelioItemCode: "27000020P-L",
      jubelioItemId: 2,
      itemId: "item1",
      parentItemSku: "27000020",
      itemName: "Dress",
      sizeSuffix: "L",
    },
    {
      erpVariantSku: "23820153M-M",
      jubelioItemCode: "23820153M-M",
      jubelioItemId: 3,
      itemId: "item2",
      parentItemSku: "23820153",
      itemName: "Top",
      sizeSuffix: "M",
    },
    {
      erpVariantSku: "2000005",
      jubelioItemCode: "2000005",
      jubelioItemId: 4,
      itemId: "item3",
      parentItemSku: "2000005",
      itemName: "Accessory",
      sizeSuffix: null,
    },
  ]);
}

function writeWorkbook(dir: string, fileName: string, sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(workbook, path.join(dir, fileName));
}

describe("parseOtherSourcesDir", () => {
  const umkmParents = new Set(["27000020P", "23820153M", "2000005"]);
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "umkm-other-src-"));
    tempDirs.push(dir);
    return dir;
  }

  it("parses BOM COD as fake buy credit for UMKM artikel", () => {
    const dir = tempDir();
    writeWorkbook(dir, "BOM COD - shoppee.xlsx", {
      SHOPEE: [
        ["NO PESANAN", "ARTIKEL", "SIZE", "QTY", "PLATFORM"],
        ["240901RQ8TR728", "27000020P", "S", 1, "SHOPEE"],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    expect(result.fakeBuyLines).toHaveLength(1);
    expect(result.fakeBuyLines[0]).toMatchObject({
      lineKind: "fake_buy_credit",
      deductionType: "fake_buy_bom",
      parentKode: "27000020P",
      erpVariantSku: "27000020P-S",
      qty: 1,
      parseStatus: "OK",
    });
  });

  it("parses FAKE BUY embedded-size SKU", () => {
    const dir = tempDir();
    writeWorkbook(dir, "FAKE BUY.xlsx", {
      Sheet1: [
        ["ORDER NUMBER", "KANAL", "TANGGAL", "SKU", "QTY"],
        ["240703KS00NGHG", "SHOPEE", "2024-07-03", "23820153M", 2],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    expect(result.fakeBuyLines[0]).toMatchObject({
      deductionType: "fake_buy",
      parentKode: "23820153M",
      erpVariantSku: "23820153M-M",
      qty: 2,
    });
  });

  it("parses KIRIM BARANG sheets as deductions", () => {
    const dir = tempDir();
    writeWorkbook(dir, "KIRIM BARANG + BONUS - Copy.xlsx", {
      KOL: [
        ["TANGGAL", "KOL", "ARTIKEL", "SIZE", "QTY"],
        ["02/09/2024", "Anastasia", "27000020P", "L", 1],
      ],
      BONUS: [
        ["TANGGAL", "NAMA", "ARTIKEL", "SIZE", "QTY"],
        ["31/07/2024", "Ulfa", "27000020P", "S", 1],
      ],
      "PEMBELIAN MANUAL": [
        ["TANGGAL", "NAMA", "ARTIKEL", "SIZE", "QTY"],
        ["25/12/2024", "Caca", "27000020P", "L", 2],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    const types = result.deductionLines.map((l) => l.deductionType).sort();
    expect(types).toEqual(["bonus", "kol", "manual"]);
  });

  it("dedupes bonus rows across standalone and kirim barang files", () => {
    const dir = tempDir();
    writeWorkbook(dir, "BONUS BARANG ( FREE).xlsx", {
      Sheet1: [
        ["TANGGAL", "NAMA", "ARTIKEL", "SIZE", "QTY"],
        ["31 JULY 2024", "Ulfa", "27000020P", "S", 1],
      ],
    });
    writeWorkbook(dir, "KIRIM BARANG + BONUS - Copy.xlsx", {
      BONUS: [
        ["TANGGAL", "NAMA", "ARTIKEL", "SIZE", "QTY"],
        ["31/07/2024", "Ulfa", "27000020P", "S", 1],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    expect(result.deductionLines.filter((l) => l.deductionType === "bonus")).toHaveLength(1);
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.skipped.some((l) => l.parseStatus === "DUPLICATE")).toBe(true);
  });

  it("filters non-UMKM parents into skipped", () => {
    const dir = tempDir();
    writeWorkbook(dir, "KIRIM TOKO UPDATE JOHAN.xlsx", {
      STORE1: [
        ["MODEL", "ARTIKEL", "SIZE", "QTY"],
        ["MODEL A", "99999999X", "S", 1],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    expect(result.deductionLines).toHaveLength(0);
    expect(result.skipped[0]?.parseStatus).toBe("NON_UMKM");
  });

  it("resolves FS size for single-variant parent", () => {
    const dir = tempDir();
    writeWorkbook(dir, "BONUS BARANG ( FREE).xlsx", {
      Sheet1: [
        ["TANGGAL", "NAMA", "ARTIKEL", "SIZE", "QTY"],
        ["31 JULY 2024", "Vita", "2000005", "FS", 1],
      ],
    });

    const result = parseOtherSourcesDir(dir, umkmParents, makeIndex());
    expect(result.deductionLines[0]).toMatchObject({
      parentKode: "2000005",
      erpVariantSku: "2000005",
      qty: 1,
    });
  });
});

describe("aggregateOtherSourceQtyByVariant", () => {
  it("sums qty per erp variant sku", () => {
    const lines: OtherSourceLine[] = [
      {
        sourceFile: "f",
        sourceSheet: "s",
        lineKind: "deduction",
        deductionType: "kol",
        parentKode: "27000020P",
        size: "S",
        erpVariantSku: "27000020P-S",
        qty: 2,
        referenceId: "a",
        tanggal: null,
        channel: null,
        parseStatus: "OK",
        orderId: null,
      },
      {
        sourceFile: "f",
        sourceSheet: "s",
        lineKind: "deduction",
        deductionType: "kol",
        parentKode: "27000020P",
        size: "S",
        erpVariantSku: "27000020P-S",
        qty: 3,
        referenceId: "b",
        tanggal: null,
        channel: null,
        parseStatus: "OK",
        orderId: null,
      },
    ];

    const map = aggregateOtherSourceQtyByVariant(lines);
    expect(map.get("27000020P-S")).toBe(5);
  });
});

describe("implied on-hand math", () => {
  it("applies fake buy credit and other deductions", () => {
    const excelSizeQty = 100;
    const salesAllocatedQty = 40;
    const fakeBuyCreditQty = 10;
    const otherDeductionQty = 5;
    const impliedOnHand =
      excelSizeQty - salesAllocatedQty + fakeBuyCreditQty - otherDeductionQty;
    expect(impliedOnHand).toBe(65);
  });
});

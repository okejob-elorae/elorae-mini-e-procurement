import { describe, expect, it } from "vitest";
import type { AuditLabelTranslator } from "./action-label";
import { angkaUang, kandidatLabelStatus, kolomUang, labelNilaiStatus } from "./nilai-audit";

function fakeTranslator(messages: Record<string, string>): AuditLabelTranslator {
  const t = ((key: string) => {
    const message = messages[key];
    if (message === undefined) throw new Error(`missing key ${key}`);
    return message;
  }) as AuditLabelTranslator;
  t.has = (key: string) => key in messages;
  return t;
}

describe("kolomUang", () => {
  it.each([
    "dpp",
    "pph",
    "ppn",
    "pph21",
    "neto",
    "bruto",
    "amount",
    "totalAmount",
    "total",
    "subtotal",
    "lineTotal",
    "unitPrice",
    "sellingPrice",
    "avgCost",
    "hargaJual",
    "nilaiBuku",
    "biayaKirim",
    "feeAmount",
    "discountAmount",
    "outstanding",
    "creditLimit",
    "after.total",
    "dates.grand_total",
  ])("%s is money", (kunci) => {
    expect(kolomUang(kunci)).toBe(true);
  });

  it.each([
    "qty",
    "totalQty",
    "lineCount",
    "totalCount",
    "ppnRatePercent",
    "pphRate",
    "marginPercent",
    "creditDays",
    "termin",
    "status",
    "invoiceNo",
    "nomorBuktiPotong",
    "tanggal",
    "storeId",
    "",
  ])("%s is not money", (kunci) => {
    expect(kolomUang(kunci)).toBe(false);
  });
});

describe("angkaUang", () => {
  it("reads numbers and decimal strings, nothing else", () => {
    expect(angkaUang(2512886.5)).toBe(2512886.5);
    expect(angkaUang("2512886.50")).toBe(2512886.5);
    expect(angkaUang("-1500")).toBe(-1500);
    expect(angkaUang("Rp 1.000")).toBeNull();
    expect(angkaUang("")).toBeNull();
    expect(angkaUang(null)).toBeNull();
    expect(angkaUang(Number.NaN)).toBeNull();
    expect(angkaUang(true)).toBeNull();
  });
});

describe("kandidatLabelStatus", () => {
  it("knows the KOL payment-term status of a collaboration audit row", () => {
    expect(kandidatLabelStatus("KolBrief", "status", "DIBAYAR")).toEqual([
      "kreatifRuang.termin.status.DIBAYAR",
      "kreatifRuang.bayar.DIBAYAR",
    ]);
    expect(kandidatLabelStatus("KolBrief", "tahap", "TAYANG")).toEqual(["kreatifRuang.tahap.TAYANG"]);
  });

  it("uses the shared status map for documents that have one", () => {
    expect(kandidatLabelStatus("PurchaseOrder", "status", "SUBMITTED")).toEqual(["statuses.poSubmitted"]);
    expect(kandidatLabelStatus("FieldSalesOrder", "deliveryStatus", "PARTIAL")).toEqual(["statuses.dlvPartial"]);
    expect(kandidatLabelStatus("TaxInvoice", "after.status", "CREATED")).toEqual(["statuses.taxCreated"]);
  });

  it("offers nothing for non-status fields, unknown documents or non-code values", () => {
    expect(kandidatLabelStatus("KolBrief", "termin", "DP")).toEqual([]);
    expect(kandidatLabelStatus("Unknown", "status", "BELUM")).toEqual([]);
    expect(kandidatLabelStatus("PurchaseOrder", "status", "Selesai sebagian")).toEqual([]);
    expect(kandidatLabelStatus("PurchaseOrder", "status", 3)).toEqual([]);
    expect(kandidatLabelStatus(null, "status", "DRAFT")).toEqual([]);
  });
});

describe("labelNilaiStatus", () => {
  const t = fakeTranslator({
    "kreatifRuang.termin.status.BELUM": "Belum dibayar",
    "kreatifRuang.termin.status.DIBAYAR": "Dibayar",
    "statuses.poSubmitted": "Dikirim ke pemasok",
  });

  it("translates a known status code into its Indonesian label", () => {
    expect(labelNilaiStatus(t, "KolBrief", "status", "BELUM")).toBe("Belum dibayar");
    expect(labelNilaiStatus(t, "KolBrief", "status", "DIBAYAR")).toBe("Dibayar");
    expect(labelNilaiStatus(t, "PurchaseOrder", "status", "SUBMITTED")).toBe("Dikirim ke pemasok");
  });

  it("spells an unknown status code as words instead of SHOUTING_CODE", () => {
    expect(labelNilaiStatus(t, "Lain", "status", "MENUNGGU_GUDANG")).toBe("Menunggu gudang");
    expect(labelNilaiStatus(t, "KolBrief", "status", "BATAL")).toBe("Batal");
  });

  it("leaves everything that is not a status code alone", () => {
    expect(labelNilaiStatus(t, "KolBrief", "termin", "DP")).toBeNull();
    expect(labelNilaiStatus(t, "KolBrief", "status", "dibayar sebagian")).toBeNull();
    expect(labelNilaiStatus(t, "KolBrief", "status", 2)).toBeNull();
  });
});

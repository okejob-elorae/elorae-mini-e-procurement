import { describe, it, expect } from "vitest";
import { penolakanNomorFaktur, TaxInvoiceError } from "./errors";
import { NomorFakturError } from "./writer";

describe("penolakanNomorFaktur", () => {
  it("memetakan sebab GANDA beserta nota pemegangnya", () => {
    const e = new NomorFakturError("GANDA", { taxInvoiceId: "ti", deliveryId: "dlv", sellThroughId: null, invoiceNo: "0100002600000001" });
    expect(penolakanNomorFaktur(e)).toEqual({ code: "NOMOR_FAKTUR_GANDA", dipakaiDeliveryId: "dlv", dipakaiSellThroughId: null });
  });

  it("memetakan sebab GANDA yang dipegang laporan sell-through konsi", () => {
    const e = new NomorFakturError("GANDA", { taxInvoiceId: "ti", deliveryId: null, sellThroughId: "st", invoiceNo: "0100002600000001" });
    expect(penolakanNomorFaktur(e)).toEqual({ code: "NOMOR_FAKTUR_GANDA", dipakaiDeliveryId: null, dipakaiSellThroughId: "st" });
  });

  it("memetakan sebab FORMAT", () => {
    expect(penolakanNomorFaktur(new NomorFakturError("FORMAT"))).toEqual({
      code: "NOMOR_FAKTUR_FORMAT",
      dipakaiDeliveryId: null,
      dipakaiSellThroughId: null,
    });
  });

  it("bukan penolakan nomor → null", () => {
    expect(penolakanNomorFaktur(new TaxInvoiceError("INVALID_REQUEST"))).toBeNull();
    expect(penolakanNomorFaktur(new TaxInvoiceError("CONFLICT"))).toBeNull();
    expect(penolakanNomorFaktur(new TaxInvoiceError("REASON_TOO_LONG"))).toBeNull();
    expect(penolakanNomorFaktur(new Error("lain"))).toBeNull();
    expect(penolakanNomorFaktur(null)).toBeNull();
  });
});

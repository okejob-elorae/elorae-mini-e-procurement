import { describe, expect, it } from "vitest";
import { ConcurrentFirstReceiptError, MainStockNegativeError } from "@elorae/db";
import { ReceiptLineError, WorkOrderNotFoundError } from "./receipt-errors";
import { toReceiptRefusal } from "./receipt-refusal";

describe("toReceiptRefusal", () => {
  it("maps the first-receipt race", () => {
    expect(toReceiptRefusal(new ConcurrentFirstReceiptError("i1", "V1"))).toEqual({
      success: false,
      code: "CONCURRENT_FIRST_RECEIPT",
    });
  });

  it("maps a negative main stock refusal", () => {
    expect(toReceiptRefusal(new MainStockNegativeError("i1", -5, 2))).toEqual({
      success: false,
      code: "MAIN_STOCK_NEGATIVE",
    });
  });

  it("maps line errors with their detail", () => {
    expect(toReceiptRefusal(new ReceiptLineError("VARIANT_REQUIRED", "SKU-1", "x"))).toEqual({
      success: false,
      code: "VARIANT_REQUIRED",
      detail: "SKU-1",
    });
  });

  it("maps a missing work order", () => {
    expect(toReceiptRefusal(new WorkOrderNotFoundError())).toEqual({ success: false, code: "WORK_ORDER_NOT_FOUND" });
  });

  it("returns null for unknown errors and non-errors", () => {
    expect(toReceiptRefusal(new Error("boom"))).toBeNull();
    expect(toReceiptRefusal("boom")).toBeNull();
  });
});

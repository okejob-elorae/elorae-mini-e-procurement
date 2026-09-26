import { describe, it, expect } from "vitest";
import { getNotificationHref } from "./navigation";

describe("getNotificationHref — konsi count schedule and report categories", () => {
  it("opens the stocktake a count notification names, in the backoffice", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
  });

  it("falls back to the store when an overdue alert names no open stocktake, and to the register when it names nothing", () => {
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "" })).toBe("/backoffice/stores/s1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", {})).toBe("/backoffice/store-stocktakes");
  });

  it("sends the SPG to the PWA count screen", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" }, "pwa")).toBe("/pwa/spg/stocktake");
  });

  it("opens the auto-created report for READY and HELD", () => {
    expect(getNotificationHref("KONSI_REPORT_READY", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_HELD", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_READY", {})).toBe("/backoffice/konsi-sell-through");
  });

  it("opens the closing stocktake for BLOCKED, where the refusal and the create button live", () => {
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", { stocktakeId: "st1", code: "DRAFT_EXISTS" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", {})).toBe("/backoffice/store-stocktakes");
  });
});

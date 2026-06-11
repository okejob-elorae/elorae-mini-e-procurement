import { describe, it, expect } from "vitest";
import { CHANNEL_BADGE, STATUS_BADGE } from "./badges";

describe("CHANNEL_BADGE", () => {
  it("has an entry per SalesChannel value with a label + tailwindClass", () => {
    expect(CHANNEL_BADGE.SHOPEE).toEqual({ labelKey: "shopee", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.TOKOPEDIA).toEqual({ labelKey: "tokopedia", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.TIKTOK).toEqual({ labelKey: "tiktok", tailwindClass: expect.any(String) });
    expect(CHANNEL_BADGE.OTHER).toEqual({ labelKey: "other", tailwindClass: expect.any(String) });
  });
});

describe("STATUS_BADGE", () => {
  it("has an entry per SalesOrderStatus value with a tailwindClass", () => {
    expect(STATUS_BADGE.NEW.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.PROCESSING.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.SHIPPED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.COMPLETED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.CANCELLED.tailwindClass).toEqual(expect.any(String));
    expect(STATUS_BADGE.RETURNED.tailwindClass).toEqual(expect.any(String));
  });
});

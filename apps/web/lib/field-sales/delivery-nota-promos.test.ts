import { describe, expect, it } from "vitest";
import { promoNameForDeliveryLine } from "./delivery-nota-promos";

describe("promoNameForDeliveryLine", () => {
  const orderLines = [
    { id: "l1", appliedPromoName: "Promo Juli" },
    { id: "l2", appliedPromoName: null },
  ];

  it("returns the order line's promo name", () => {
    expect(promoNameForDeliveryLine(orderLines, "l1")).toBe("Promo Juli");
  });

  it("returns null when the order line has no promo", () => {
    expect(promoNameForDeliveryLine(orderLines, "l2")).toBeNull();
  });

  it("returns null for an unknown order line", () => {
    expect(promoNameForDeliveryLine(orderLines, "nope")).toBeNull();
  });
});

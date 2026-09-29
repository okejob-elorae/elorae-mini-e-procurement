import { describe, it, expect } from "vitest";
import { isSameActorReplay, podCompletionBlock } from "./pod-completion-guard";

const ME = "user-me";

describe("podCompletionBlock", () => {
  it("hides a shipment carried by someone else", () => {
    expect(
      podCompletionBlock({ carriedById: "other", status: "IN_TRANSIT", method: "SALESMAN_CARRY" }, ME),
    ).toBe("NOT_FOUND");
  });

  it("hides a shipment with no carrier", () => {
    expect(
      podCompletionBlock({ carriedById: null, status: "IN_TRANSIT", method: "EXPEDITION" }, ME),
    ).toBe("NOT_FOUND");
  });

  it("checks ownership before status", () => {
    expect(
      podCompletionBlock({ carriedById: "other", status: "DELIVERED", method: "SALESMAN_CARRY" }, ME),
    ).toBe("NOT_FOUND");
  });

  it("refuses an own EXPEDITION shipment", () => {
    expect(
      podCompletionBlock({ carriedById: ME, status: "IN_TRANSIT", method: "EXPEDITION" }, ME),
    ).toBe("NOT_COMPLETABLE");
  });

  it.each(["PACKED", "DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED"])(
    "refuses an own SALESMAN_CARRY shipment that is %s",
    (status) => {
      expect(
        podCompletionBlock({ carriedById: ME, status, method: "SALESMAN_CARRY" }, ME),
      ).toBe("NOT_COMPLETABLE");
    },
  );

  it("allows an own IN_TRANSIT SALESMAN_CARRY shipment", () => {
    expect(
      podCompletionBlock({ carriedById: ME, status: "IN_TRANSIT", method: "SALESMAN_CARRY" }, ME),
    ).toBeNull();
  });
});

describe("isSameActorReplay", () => {
  it("is true for a DELIVERED shipment completed by the same actor", () => {
    expect(isSameActorReplay({ status: "DELIVERED", deliveredById: ME }, ME)).toBe(true);
  });

  it("is true for a PARTIALLY_DELIVERED shipment completed by the same actor", () => {
    expect(isSameActorReplay({ status: "PARTIALLY_DELIVERED", deliveredById: ME }, ME)).toBe(true);
  });

  it("is false when a different actor completed it", () => {
    expect(isSameActorReplay({ status: "DELIVERED", deliveredById: "other" }, ME)).toBe(false);
  });

  it.each(["IN_TRANSIT", "PACKED", "CANCELLED"])("is false for a %s shipment", (status) => {
    expect(isSameActorReplay({ status, deliveredById: ME }, ME)).toBe(false);
  });

  it("is false when nobody has completed it", () => {
    expect(isSameActorReplay({ status: "DELIVERED", deliveredById: null }, ME)).toBe(false);
  });
});

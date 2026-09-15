import { describe, expect, it } from "vitest";
import { normaliseVariantKey, resolveLocationKey } from "./stock-ledger";

describe("normaliseVariantKey", () => {
  it("maps null and undefined to the empty string", () => {
    expect(normaliseVariantKey(null)).toBe("");
    expect(normaliseVariantKey(undefined)).toBe("");
  });

  it("leaves a real sku untouched", () => {
    expect(normaliseVariantKey("SKU-RED-L")).toBe("SKU-RED-L");
  });

  it("leaves an already-empty string as the empty string", () => {
    expect(normaliseVariantKey("")).toBe("");
  });
});

describe("resolveLocationKey", () => {
  it("gives MAIN an empty location id", () => {
    expect(resolveLocationKey({ type: "MAIN" })).toEqual({ locationType: "MAIN", locationId: "" });
  });

  it("keys a store on its store id", () => {
    expect(resolveLocationKey({ type: "STORE", storeId: "store_1" })).toEqual({
      locationType: "STORE",
      locationId: "store_1",
    });
  });

  it("keys a van on the canvasser's user id", () => {
    expect(resolveLocationKey({ type: "VAN", userId: "user_1" })).toEqual({
      locationType: "VAN",
      locationId: "user_1",
    });
  });
});

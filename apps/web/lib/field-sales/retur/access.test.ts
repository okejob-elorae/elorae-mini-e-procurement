import { describe, expect, it } from "vitest";
import { canViewFieldReturns } from "./access";

describe("canViewFieldReturns", () => {
  it("admits the wildcard", () => {
    expect(canViewFieldReturns(["*"])).toBe(true);
  });

  it("admits field_sales_orders:view", () => {
    expect(canViewFieldReturns(["field_sales_orders:view"])).toBe(true);
  });

  it("admits field_returns:manage", () => {
    expect(canViewFieldReturns(["field_returns:manage"])).toBe(true);
  });

  it("refuses field_returns:writeoff alone", () => {
    expect(canViewFieldReturns(["field_returns:writeoff"])).toBe(false);
  });

  it("refuses an empty permission set", () => {
    expect(canViewFieldReturns([])).toBe(false);
  });
});

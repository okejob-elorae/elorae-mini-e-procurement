import { describe, expect, it } from "vitest";
import { isClassifiableType, resolveCashFlowSection } from "./cash-flow-classify";

describe("isClassifiableType", () => {
  it("accepts only balance-sheet types", () => {
    expect(isClassifiableType("ASET")).toBe(true);
    expect(isClassifiableType("LIABILITAS")).toBe(true);
    expect(isClassifiableType("EKUITAS")).toBe(true);
    expect(isClassifiableType("PENDAPATAN")).toBe(false);
    expect(isClassifiableType("HPP")).toBe(false);
    expect(isClassifiableType("BEBAN")).toBe(false);
  });
});

describe("resolveCashFlowSection", () => {
  it("never classifies a profit-and-loss account, even with an override", () => {
    expect(
      resolveCashFlowSection({ type: "PENDAPATAN", override: "OPERASIONAL" }),
    ).toBeNull();
    expect(resolveCashFlowSection({ type: "BEBAN", roles: ["MARKETPLACE_FEE"] })).toBeNull();
  });

  it("prefers an explicit override over every derived answer", () => {
    expect(
      resolveCashFlowSection({ type: "ASET", override: "INVESTASI", roles: ["AR"] }),
    ).toBe("INVESTASI");
    expect(
      resolveCashFlowSection({ type: "EKUITAS", override: "OPERASIONAL" }),
    ).toBe("OPERASIONAL");
  });

  it("derives KAS from the bank and cash roles", () => {
    expect(resolveCashFlowSection({ type: "ASET", roles: ["BANK"] })).toBe("KAS");
    expect(resolveCashFlowSection({ type: "ASET", roles: ["CASH"] })).toBe("KAS");
  });

  it("derives OPERASIONAL from working-capital roles", () => {
    expect(resolveCashFlowSection({ type: "ASET", roles: ["AR"] })).toBe("OPERASIONAL");
    expect(resolveCashFlowSection({ type: "LIABILITAS", roles: ["AP"] })).toBe("OPERASIONAL");
    expect(resolveCashFlowSection({ type: "ASET", roles: ["INVENTORY"] })).toBe("OPERASIONAL");
    expect(resolveCashFlowSection({ type: "ASET", roles: ["INVENTORY_FG"] })).toBe("OPERASIONAL");
    expect(resolveCashFlowSection({ type: "ASET", roles: ["INVENTORY_VAN"] })).toBe("OPERASIONAL");
  });

  it("lets KAS win when an account carries conflicting roles", () => {
    expect(
      resolveCashFlowSection({ type: "ASET", roles: ["INVENTORY", "BANK"] }),
    ).toBe("KAS");
    expect(
      resolveCashFlowSection({ type: "ASET", roles: ["BANK", "INVENTORY"] }),
    ).toBe("KAS");
  });

  it("falls back to POSTING_ROLES order when no role says KAS", () => {
    /* INVENTORY precedes AR in POSTING_ROLES, so argument order must not matter. */
    expect(
      resolveCashFlowSection({ type: "ASET", roles: ["AR", "INVENTORY"] }),
    ).toBe("OPERASIONAL");
  });

  it("ignores roles that carry no section", () => {
    expect(resolveCashFlowSection({ type: "ASET", roles: ["TAX"] })).toBeNull();
  });

  it("defaults equity to PENDANAAN when no role applies", () => {
    expect(resolveCashFlowSection({ type: "EKUITAS" })).toBe("PENDANAAN");
  });

  it("leaves a non-role asset or liability unclassified", () => {
    expect(resolveCashFlowSection({ type: "ASET" })).toBeNull();
    expect(resolveCashFlowSection({ type: "LIABILITAS" })).toBeNull();
  });
});

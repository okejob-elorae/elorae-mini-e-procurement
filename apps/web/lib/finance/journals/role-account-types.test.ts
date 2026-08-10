import { describe, expect, it } from "vitest";
import { POSTING_ROLE_ACCOUNT_TYPES, isAccountTypeValidForRole } from "./role-account-types";
import { POSTING_ROLES } from "@/lib/constants/journal-roles";

describe("POSTING_ROLE_ACCOUNT_TYPES", () => {
  it("covers every posting role", () => {
    for (const role of POSTING_ROLES) {
      expect(POSTING_ROLE_ACCOUNT_TYPES[role], `missing entry for ${role}`).toBeDefined();
      expect(POSTING_ROLE_ACCOUNT_TYPES[role].length).toBeGreaterThan(0);
    }
  });
});

describe("isAccountTypeValidForRole", () => {
  it("requires asset accounts for cash, bank, receivable, and inventory roles", () => {
    for (const role of ["BANK", "CASH", "AR", "INVENTORY", "INVENTORY_FG", "INVENTORY_VAN"] as const) {
      expect(isAccountTypeValidForRole(role, "ASET")).toBe(true);
      expect(isAccountTypeValidForRole(role, "LIABILITAS")).toBe(false);
      expect(isAccountTypeValidForRole(role, "BEBAN")).toBe(false);
    }
  });

  it("requires a liability account for payables — the Hutang regression", () => {
    expect(isAccountTypeValidForRole("AP", "LIABILITAS")).toBe(true);
    expect(isAccountTypeValidForRole("AP", "ASET")).toBe(false);
  });

  it("requires revenue and cost accounts for their roles", () => {
    expect(isAccountTypeValidForRole("SALES_REVENUE", "PENDAPATAN")).toBe(true);
    expect(isAccountTypeValidForRole("SALES_REVENUE", "ASET")).toBe(false);
    expect(isAccountTypeValidForRole("COGS", "HPP")).toBe(true);
    expect(isAccountTypeValidForRole("COGS", "BEBAN")).toBe(false);
  });

  it("requires expense accounts for every marketplace fee role and inventory variance", () => {
    for (const role of [
      "MARKETPLACE_FEE",
      "MARKETPLACE_FEE_ADMIN",
      "MARKETPLACE_FEE_SERVICE",
      "MARKETPLACE_FEE_COMMISSION",
      "MARKETPLACE_FEE_PROCESSING",
      "MARKETPLACE_FEE_OTHER",
      "INVENTORY_VARIANCE",
    ] as const) {
      expect(isAccountTypeValidForRole(role, "BEBAN")).toBe(true);
      expect(isAccountTypeValidForRole(role, "ASET")).toBe(false);
    }
  });

  it("accepts either a liability or an expense account for tax", () => {
    expect(isAccountTypeValidForRole("TAX", "LIABILITAS")).toBe(true);
    expect(isAccountTypeValidForRole("TAX", "BEBAN")).toBe(true);
    expect(isAccountTypeValidForRole("TAX", "ASET")).toBe(false);
  });
});

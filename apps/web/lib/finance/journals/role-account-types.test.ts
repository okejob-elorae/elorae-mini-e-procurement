import { describe, expect, it } from "vitest";
import { POSTING_ROLE_ACCOUNT_TYPES, isAccountTypeValidForRole } from "./role-account-types";
import { POSTING_ROLES } from "@/lib/constants/journal-roles";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";

describe("POSTING_ROLE_ACCOUNT_TYPES", () => {
  it("covers every posting role", () => {
    for (const role of POSTING_ROLES) {
      expect(POSTING_ROLE_ACCOUNT_TYPES[role], `missing entry for ${role}`).toBeDefined();
      expect(POSTING_ROLE_ACCOUNT_TYPES[role].length).toBeGreaterThan(0);
    }
  });
});

describe("label & keterangan peran di Pemetaan Akun", () => {
  /*
   * Peran tanpa `financeAccountMapping.role.*`/`.desc.*` tampil sebagai kunci
   * mentah di halaman pemetaan (temuan tinjauan 13-02). Tes ini satu-satunya
   * jaring: type-check apps/web tidak berjalan di sini.
   */
  it("setiap peran posting punya label dan keterangan di kedua bahasa", () => {
    const kurang: string[] = [];
    for (const [nama, pesan] of [["id", id], ["en", en]] as const) {
      const fam = (pesan as { financeAccountMapping: { role: Record<string, string>; desc: Record<string, string> } }).financeAccountMapping;
      for (const role of POSTING_ROLES) {
        if (!fam.role[role]?.trim()) kurang.push(`${nama}.role.${role}`);
        if (!fam.desc[role]?.trim()) kurang.push(`${nama}.desc.${role}`);
      }
    }
    expect(kurang).toEqual([]);
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

  it("peran akuntansi & pajak lengkap memakai tipe akun yang benar", () => {
    const harapan: Record<string, string[]> = {
      AR_STORE: ["ASET"],
      AR_CONSIGNMENT: ["ASET"],
      INVENTORY_CONSIGNMENT: ["ASET"],
      INVENTORY_DAMAGED: ["ASET"],
      SALES_RETURN: ["PENDAPATAN"],
      SALES_DISCOUNT: ["PENDAPATAN"],
      PPN_MASUKAN: ["ASET"],
      PPN_KELUARAN: ["LIABILITAS"],
      PPN_PAYABLE: ["LIABILITAS"],
      PPH4_2_PAYABLE: ["LIABILITAS"],
      PPH_FINAL_PAYABLE: ["LIABILITAS"],
      PPH_FINAL_EXPENSE: ["BEBAN"],
      PPH22_PREPAID: ["ASET"],
      PPH23_PREPAID: ["ASET"],
      PPH25_PREPAID: ["ASET"],
      SPG_COMMISSION_EXPENSE: ["BEBAN"],
      SALES_COMMISSION_EXPENSE: ["BEBAN"],
      COMMISSION_PAYABLE: ["LIABILITAS"],
      LOSS_EXPENSE: ["BEBAN"],
      LOSS_RECOVERY: ["PENDAPATAN", "BEBAN"],
      TRAVEL_EXPENSE: ["BEBAN"],
      REIMBURSE_PAYABLE: ["LIABILITAS"],
      FIXED_ASSET: ["ASET"],
      ACCUM_DEPRECIATION: ["ASET"],
      DEPRECIATION_EXPENSE: ["BEBAN"],
      ASSET_DISPOSAL_GAIN_LOSS: ["PENDAPATAN", "BEBAN"],
      RETAINED_EARNINGS: ["EKUITAS"],
      OPENING_EQUITY: ["EKUITAS"],
      BANK_CHARGES: ["BEBAN"],
      OTHER_INCOME: ["PENDAPATAN"],
      PREPAID_EXPENSE: ["ASET"],
      ACCRUED_EXPENSE: ["LIABILITAS"],
    };
    expect(Object.keys(harapan)).toHaveLength(32);
    for (const [role, tipe] of Object.entries(harapan)) {
      expect(POSTING_ROLES, role).toContain(role);
      expect([...POSTING_ROLE_ACCOUNT_TYPES[role as keyof typeof POSTING_ROLE_ACCOUNT_TYPES]].sort(), role).toEqual([...tipe].sort());
    }
  });
});

import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";

/**
 * The account type each posting role must be mapped to.
 *
 * Nothing validated this before, which is how `13 Hutang` came to be typed
 * ASET while carrying the AP role: every GRN credited it, so payables rendered
 * as a negative asset and the Neraca understated both sides while still
 * balancing. `TAX` is deliberately permissive — a tax account is legitimately
 * either a liability (tax payable) or an expense (tax borne).
 */
export const POSTING_ROLE_ACCOUNT_TYPES: Record<PostingRole, readonly AccountType[]> = {
  INVENTORY: ["ASET"],
  INVENTORY_FG: ["ASET"],
  INVENTORY_VAN: ["ASET"],
  AP: ["LIABILITAS"],
  AR: ["ASET"],
  SALES_REVENUE: ["PENDAPATAN"],
  COGS: ["HPP"],
  BANK: ["ASET"],
  CASH: ["ASET"],
  MARKETPLACE_FEE: ["BEBAN"],
  MARKETPLACE_FEE_ADMIN: ["BEBAN"],
  MARKETPLACE_FEE_SERVICE: ["BEBAN"],
  MARKETPLACE_FEE_COMMISSION: ["BEBAN"],
  MARKETPLACE_FEE_PROCESSING: ["BEBAN"],
  MARKETPLACE_FEE_OTHER: ["BEBAN"],
  INVENTORY_VARIANCE: ["BEBAN"],
  TAX: ["LIABILITAS", "BEBAN"],
};

export function isAccountTypeValidForRole(role: PostingRole, type: AccountType): boolean {
  return POSTING_ROLE_ACCOUNT_TYPES[role].includes(type);
}

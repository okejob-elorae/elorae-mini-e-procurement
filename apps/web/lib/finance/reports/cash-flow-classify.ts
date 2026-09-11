import type { AccountType } from "@/lib/constants/enums";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";

export type CashFlowSection = "KAS" | "OPERASIONAL" | "INVESTASI" | "PENDANAAN";

export const CASH_FLOW_SECTIONS: readonly CashFlowSection[] = [
  "KAS",
  "OPERASIONAL",
  "INVESTASI",
  "PENDANAAN",
];

/**
 * Roles whose section is unambiguous. Everything else is either a
 * profit-and-loss role — already inside net income — or a role that says
 * nothing about cash-flow presentation.
 */
const ROLE_SECTIONS: Partial<Record<PostingRole, CashFlowSection>> = {
  BANK: "KAS",
  CASH: "KAS",
  AR: "OPERASIONAL",
  AP: "OPERASIONAL",
  INVENTORY: "OPERASIONAL",
  INVENTORY_FG: "OPERASIONAL",
  INVENTORY_VAN: "OPERASIONAL",
};

const CLASSIFIABLE: readonly AccountType[] = ["ASET", "LIABILITAS", "EKUITAS"];

/**
 * Revenue, cost of goods and expenses are already folded into net income, so
 * they are never adjusted separately and never carry a section.
 */
export function isClassifiableType(type: AccountType): boolean {
  return CLASSIFIABLE.includes(type);
}

/**
 * Section for one account: an explicit override wins, then posting role, then
 * the equity convention, then unclassified.
 *
 * An account may carry several roles, so the tiebreak is stated rather than
 * left to map-iteration order: any KAS role wins outright, otherwise the first
 * match in `POSTING_ROLES` order decides. Argument order of `roles` is never
 * significant.
 *
 * A non-role asset or liability resolves to null on purpose. A fixed asset
 * versus a prepayment is a judgement no schema can make, and defaulting it to
 * OPERASIONAL would produce a plausible figure nobody could tell was wrong.
 */
export function resolveCashFlowSection(input: {
  type: AccountType;
  override?: CashFlowSection | null;
  roles?: readonly PostingRole[];
}): CashFlowSection | null {
  if (!isClassifiableType(input.type)) return null;
  if (input.override) return input.override;

  const roles = input.roles ?? [];
  if (roles.some((role) => ROLE_SECTIONS[role] === "KAS")) return "KAS";

  for (const role of POSTING_ROLES) {
    if (!roles.includes(role)) continue;
    const section = ROLE_SECTIONS[role];
    if (section) return section;
  }

  if (input.type === "EKUITAS") return "PENDANAAN";
  return null;
}

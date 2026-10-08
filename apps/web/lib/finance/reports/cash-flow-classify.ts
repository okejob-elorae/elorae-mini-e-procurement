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
  KOL_PAYABLE: "OPERASIONAL",
  KOL_PREPAID: "OPERASIONAL",
  PPH21_PAYABLE: "OPERASIONAL",
  PPH23_PAYABLE: "OPERASIONAL",
  AR_STORE: "OPERASIONAL",
  AR_CONSIGNMENT: "OPERASIONAL",
  INVENTORY_CONSIGNMENT: "OPERASIONAL",
  INVENTORY_DAMAGED: "OPERASIONAL",
  PPN_MASUKAN: "OPERASIONAL",
  PPN_KELUARAN: "OPERASIONAL",
  PPN_PAYABLE: "OPERASIONAL",
  PPH4_2_PAYABLE: "OPERASIONAL",
  PPH_FINAL_PAYABLE: "OPERASIONAL",
  PPH22_PREPAID: "OPERASIONAL",
  PPH23_PREPAID: "OPERASIONAL",
  PPH25_PREPAID: "OPERASIONAL",
  COMMISSION_PAYABLE: "OPERASIONAL",
  REIMBURSE_PAYABLE: "OPERASIONAL",
  PREPAID_EXPENSE: "OPERASIONAL",
  ACCRUED_EXPENSE: "OPERASIONAL",
  FIXED_ASSET: "INVESTASI",
  // Hampir seluruh geraknya penyusutan — beban non-kas yang ditambahkan kembali
  // di arus kas OPERASIONAL (metode tidak langsung), bukan investasi.
  ACCUM_DEPRECIATION: "OPERASIONAL",
  /*
   * RETAINED_EARNINGS dan OPENING_EQUITY sengaja TIDAK di sini: ekuitas jatuh ke
   * PENDANAAN lewat konvensi tipe. Jurnal penutup tahun (`YEAR_END_CLOSE`) dan
   * jurnal saldo awal (`OPENING`) bukan arus kas — penyusun laporan arus kas
   * harus mengecualikan kedua sumber itu, bukan mengandalkan seksi peran.
   */
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

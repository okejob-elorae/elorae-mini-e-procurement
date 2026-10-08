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
  KOL_EXPENSE: ["BEBAN"],
  KOL_PAYABLE: ["LIABILITAS"],
  KOL_PREPAID: ["ASET"],
  PPH21_PAYABLE: ["LIABILITAS"],
  PPH23_PAYABLE: ["LIABILITAS"],
  AR_STORE: ["ASET"],
  AR_CONSIGNMENT: ["ASET"],
  INVENTORY_CONSIGNMENT: ["ASET"],
  INVENTORY_DAMAGED: ["ASET"],
  // Kontra pendapatan: bersaldo debit di dalam kelompok Pendapatan, supaya Laba
  // Rugi menyajikan penjualan BERSIH, bukan beban.
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
  // Penggantian barang hilang: pendapatan lain, atau pengurang beban yang sama.
  LOSS_RECOVERY: ["PENDAPATAN", "BEBAN"],
  TRAVEL_EXPENSE: ["BEBAN"],
  REIMBURSE_PAYABLE: ["LIABILITAS"],
  FIXED_ASSET: ["ASET"],
  // Kontra aset: bersaldo kredit di dalam kelompok Aset.
  ACCUM_DEPRECIATION: ["ASET"],
  DEPRECIATION_EXPENSE: ["BEBAN"],
  // Laba ATAU rugi pelepasan aset — satu akun bisa di salah satu kelompok.
  ASSET_DISPOSAL_GAIN_LOSS: ["PENDAPATAN", "BEBAN"],
  RETAINED_EARNINGS: ["EKUITAS"],
  OPENING_EQUITY: ["EKUITAS"],
  BANK_CHARGES: ["BEBAN"],
  OTHER_INCOME: ["PENDAPATAN"],
  PREPAID_EXPENSE: ["ASET"],
  ACCRUED_EXPENSE: ["LIABILITAS"],
};

export function isAccountTypeValidForRole(role: PostingRole, type: AccountType): boolean {
  return POSTING_ROLE_ACCOUNT_TYPES[role].includes(type);
}

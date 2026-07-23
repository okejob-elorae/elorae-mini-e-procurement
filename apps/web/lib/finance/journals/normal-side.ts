import type { AccountType } from "@/lib/constants/enums";

/**
 * Debit-normal account types accumulate balance on the debit side
 * (ASET, HPP, BEBAN). Everything else (LIABILITAS, EKUITAS, PENDAPATAN)
 * is credit-normal.
 */
export function isDebitNormal(type: AccountType): boolean {
  return type === "ASET" || type === "HPP" || type === "BEBAN";
}

/**
 * Signed delta a single journal line contributes to an account's running
 * balance, oriented so debit-normal accounts increase on debit and
 * credit-normal accounts increase on credit.
 */
export function signedDelta(type: AccountType, debit: number, credit: number): number {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

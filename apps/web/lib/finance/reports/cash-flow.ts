import type { AccountType } from "@/lib/constants/enums";
import type { BalanceRow } from "./balances";
import { buildIncomeStatement } from "./income-statement";
import { isClassifiableType, type CashFlowSection } from "./cash-flow-classify";

export type CashFlowLine = {
  accountId: string;
  code: string;
  name: string;
  amount: number;
};

export type CashFlowStatement = {
  labaBersih: number;
  operasional: CashFlowLine[];
  totalOperasional: number;
  investasi: CashFlowLine[];
  totalInvestasi: number;
  pendanaan: CashFlowLine[];
  totalPendanaan: number;
  unclassified: CashFlowLine[];
  totalUnclassified: number;
  netChange: number;
  kasAwal: number;
  kasAkhir: number;
  kasAkhirActual: number;
  isReconciled: boolean;
  hasCashAccount: boolean;
  hasMovement: boolean;
};

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Cash effect of one non-cash account's period movement. An asset rising
 * consumes cash; a liability or equity claim rising supplies it.
 */
function contributionCents(type: AccountType, signed: number): number {
  return type === "ASET" ? -toCents(signed) : toCents(signed);
}

const sumCents = (lines: Array<{ amount: number }>): number =>
  lines.reduce((total, line) => total + toCents(line.amount), 0);

const byCode = (a: CashFlowLine, b: CashFlowLine) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/**
 * Statement of cash flows, indirect method.
 *
 * Net change is derived from every NON-cash account's period delta rather than
 * from cash movements. Because `postJournal` guarantees each journal balances,
 * `ΔKas = LabaBersih + ΔLiabilitas + ΔEkuitas − ΔAsetNonKas` is an identity, so
 * `isReconciled` can only go false on corrupt ledger data — it is a tripwire,
 * not a genuine check, in the same sense as the trial balance's equality.
 *
 * Two consequences follow, and both are load-bearing. Section assignment is
 * presentation only: a misclassified account moves a line between sections and
 * cannot change any total. And unclassified accounts stay inside `netChange`
 * while rendering in their own bucket, so incomplete classification degrades
 * presentation without ever corrupting arithmetic.
 */
export function buildCashFlow(input: {
  rows: BalanceRow[];
  sectionByAccountId: Map<string, CashFlowSection | null>;
  kasAwal: number;
}): CashFlowStatement {
  const labaBersih = buildIncomeStatement(input.rows).labaBersih;

  const operasional: CashFlowLine[] = [];
  const investasi: CashFlowLine[] = [];
  const pendanaan: CashFlowLine[] = [];
  const unclassified: CashFlowLine[] = [];

  /**
   * Derived from the classified set rather than the period's rows. A cash
   * account that is inactive and had no movement in the window is dropped by
   * `getAccountBalances`, so reading the rows would report no cash account
   * configured while `cashAccountIds` — built from this same map — still found
   * it and computed `kasAwal` from it. The two derivations have to agree about
   * what "the cash accounts" are.
   */
  const hasCashAccount = [...input.sectionByAccountId.values()].some(
    (section) => section === "KAS",
  );
  let cashDeltaCents = 0;

  for (const row of input.rows) {
    if (!isClassifiableType(row.type)) continue;

    const section = input.sectionByAccountId.get(row.accountId) ?? null;
    if (section === "KAS") {
      /**
       * Debit minus credit, NOT `row.signed`. `signed` flips orientation for
       * credit-normal types, whereas `netChange` and `getCashOpeningBalance`
       * both read cash as debit minus credit. `setCashFlowSectionAction` now
       * restricts KAS to ASET, where the two coincide, so this is a no-op
       * today — it is written out so the engine, the opening-balance query and
       * the balance identity state one orientation rather than three paths
       * that happen to agree.
       */
      cashDeltaCents += toCents(row.debit) - toCents(row.credit);
      continue;
    }

    const amountCents = contributionCents(row.type, row.signed);
    if (amountCents === 0) continue;

    const line: CashFlowLine = {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount: amountCents / 100,
    };

    if (section === "OPERASIONAL") operasional.push(line);
    else if (section === "INVESTASI") investasi.push(line);
    else if (section === "PENDANAAN") pendanaan.push(line);
    else unclassified.push(line);
  }

  operasional.sort(byCode);
  investasi.sort(byCode);
  pendanaan.sort(byCode);
  unclassified.sort(byCode);

  const totalOperasionalCents = toCents(labaBersih) + sumCents(operasional);
  const totalInvestasiCents = sumCents(investasi);
  const totalPendanaanCents = sumCents(pendanaan);
  const totalUnclassifiedCents = sumCents(unclassified);
  const netChangeCents =
    totalOperasionalCents +
    totalInvestasiCents +
    totalPendanaanCents +
    totalUnclassifiedCents;

  const kasAwalCents = toCents(input.kasAwal);

  return {
    labaBersih,
    operasional,
    totalOperasional: totalOperasionalCents / 100,
    investasi,
    totalInvestasi: totalInvestasiCents / 100,
    pendanaan,
    totalPendanaan: totalPendanaanCents / 100,
    unclassified,
    totalUnclassified: totalUnclassifiedCents / 100,
    netChange: netChangeCents / 100,
    kasAwal: input.kasAwal,
    kasAkhir: (kasAwalCents + netChangeCents) / 100,
    kasAkhirActual: (kasAwalCents + cashDeltaCents) / 100,
    isReconciled: netChangeCents === cashDeltaCents,
    hasCashAccount,
    /* Distinguishes "no journals in this period" from "movements that net to zero". */
    hasMovement: input.rows.some((row) => row.debit !== 0 || row.credit !== 0),
  };
}

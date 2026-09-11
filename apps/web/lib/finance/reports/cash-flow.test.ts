import { describe, expect, it } from "vitest";
import { buildCashFlow } from "./cash-flow";
import type { CashFlowSection } from "./cash-flow-classify";
import type { BalanceRow } from "./balances";
import { signedDelta } from "@/lib/finance/journals/normal-side";
import type { AccountType } from "@/lib/constants/enums";

function row(
  accountId: string,
  code: string,
  type: AccountType,
  debit: number,
  credit: number,
): BalanceRow {
  return {
    accountId,
    code,
    name: `Account ${code}`,
    type,
    parentId: null,
    depth: 0,
    isActive: true,
    hasChildren: false,
    debit,
    credit,
    signed: signedDelta(type, debit, credit),
  };
}

function sections(
  entries: Array<[string, CashFlowSection | null]>,
): Map<string, CashFlowSection | null> {
  return new Map(entries);
}

describe("buildCashFlow", () => {
  it("treats a cash sale as operating cash in", () => {
    /* DR Kas 1.000.000 / CR Pendapatan 1.000.000 */
    const rows = [
      row("kas", "1101", "ASET", 1_000_000, 0),
      row("rev", "4100", "PENDAPATAN", 0, 1_000_000),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([["kas", "KAS"]]),
      kasAwal: 500_000,
    });

    expect(cf.labaBersih).toBe(1_000_000);
    expect(cf.totalOperasional).toBe(1_000_000);
    expect(cf.netChange).toBe(1_000_000);
    expect(cf.kasAwal).toBe(500_000);
    expect(cf.kasAkhir).toBe(1_500_000);
    expect(cf.kasAkhirActual).toBe(1_500_000);
    expect(cf.isReconciled).toBe(true);
  });

  it("subtracts a receivable increase from operating cash", () => {
    /* DR Piutang 1.000.000 / CR Pendapatan 1.000.000 — no cash moved. */
    const rows = [
      row("ar", "1201", "ASET", 1_000_000, 0),
      row("rev", "4100", "PENDAPATAN", 0, 1_000_000),
      row("kas", "1101", "ASET", 0, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["ar", "OPERASIONAL"],
      ]),
      kasAwal: 0,
    });

    expect(cf.labaBersih).toBe(1_000_000);
    expect(cf.operasional).toEqual([
      { accountId: "ar", code: "1201", name: "Account 1201", amount: -1_000_000 },
    ]);
    expect(cf.totalOperasional).toBe(0);
    expect(cf.netChange).toBe(0);
    expect(cf.isReconciled).toBe(true);
  });

  it("adds a payable increase to operating cash", () => {
    /* DR Beban 400.000 / CR Hutang 400.000 */
    const rows = [
      row("exp", "6100", "BEBAN", 400_000, 0),
      row("ap", "2101", "LIABILITAS", 0, 400_000),
      row("kas", "1101", "ASET", 0, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["ap", "OPERASIONAL"],
      ]),
      kasAwal: 0,
    });

    expect(cf.labaBersih).toBe(-400_000);
    expect(cf.operasional[0].amount).toBe(400_000);
    expect(cf.totalOperasional).toBe(0);
    expect(cf.netChange).toBe(0);
  });

  it("reports an asset purchase as investing cash out", () => {
    /* DR Kendaraan 50.000.000 / CR Kas 50.000.000 */
    const rows = [
      row("veh", "1501", "ASET", 50_000_000, 0),
      row("kas", "1101", "ASET", 0, 50_000_000),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["veh", "INVESTASI"],
      ]),
      kasAwal: 80_000_000,
    });

    expect(cf.totalInvestasi).toBe(-50_000_000);
    expect(cf.netChange).toBe(-50_000_000);
    expect(cf.kasAkhir).toBe(30_000_000);
    expect(cf.isReconciled).toBe(true);
  });

  it("reports owner capital as financing cash in", () => {
    /* DR Kas 20.000.000 / CR Modal 20.000.000 */
    const rows = [
      row("kas", "1101", "ASET", 20_000_000, 0),
      row("cap", "3100", "EKUITAS", 0, 20_000_000),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["cap", "PENDANAAN"],
      ]),
      kasAwal: 0,
    });

    expect(cf.totalPendanaan).toBe(20_000_000);
    expect(cf.netChange).toBe(20_000_000);
    expect(cf.isReconciled).toBe(true);
  });

  it("keeps unclassified accounts inside the total so the statement still reconciles", () => {
    const rows = [
      row("kas", "1101", "ASET", 0, 7_000_000),
      row("mystery", "1901", "ASET", 7_000_000, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["mystery", null],
      ]),
      kasAwal: 7_000_000,
    });

    expect(cf.unclassified).toHaveLength(1);
    expect(cf.totalUnclassified).toBe(-7_000_000);
    expect(cf.netChange).toBe(-7_000_000);
    expect(cf.kasAkhir).toBe(0);
    expect(cf.isReconciled).toBe(true);
  });

  it("adds back depreciation without a special case", () => {
    /* DR Beban Penyusutan 300.000 / CR Akumulasi Penyusutan 300.000 */
    const rows = [
      row("dep", "6300", "BEBAN", 300_000, 0),
      row("accdep", "1599", "ASET", 0, 300_000),
      row("kas", "1101", "ASET", 0, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["accdep", "OPERASIONAL"],
      ]),
      kasAwal: 0,
    });

    expect(cf.labaBersih).toBe(-300_000);
    expect(cf.operasional[0].amount).toBe(300_000);
    expect(cf.totalOperasional).toBe(0);
    expect(cf.netChange).toBe(0);
  });

  it("omits accounts with no movement and sorts lines by code", () => {
    const rows = [
      row("kas", "1101", "ASET", 0, 0),
      row("b", "1300", "ASET", 0, 0),
      row("c", "1250", "ASET", 100_000, 0),
      row("a", "1210", "ASET", 50_000, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["a", "OPERASIONAL"],
        ["b", "OPERASIONAL"],
        ["c", "OPERASIONAL"],
      ]),
      kasAwal: 0,
    });

    expect(cf.operasional.map((l) => l.code)).toEqual(["1210", "1250"]);
  });

  it("reports no movement when the period holds no journal lines", () => {
    const rows = [row("kas", "1101", "ASET", 0, 0), row("ar", "1201", "ASET", 0, 0)];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["ar", "OPERASIONAL"],
      ]),
      kasAwal: 250_000,
    });

    expect(cf.hasMovement).toBe(false);
    expect(cf.kasAkhir).toBe(250_000);
  });

  it("reports movement even when the period nets to zero", () => {
    const rows = [
      row("kas", "1101", "ASET", 1_000, 1_000),
      row("ar", "1201", "ASET", 0, 0),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([["kas", "KAS"]]),
      kasAwal: 0,
    });

    expect(cf.hasMovement).toBe(true);
    expect(cf.netChange).toBe(0);
  });

  it("reports a cash account from the section map even when no row carries it", () => {
    /**
     * A cash account that is inactive and had no movement in the window is
     * dropped by `getAccountBalances`, so it never reaches `rows` — while
     * `cashAccountIds`, built from this same map, still finds it and computes
     * `kasAwal` from it. Deriving the flag from the row loop instead reported
     * "no cash account configured" on a report that had one.
     */
    const rows = [row("ar", "1201", "ASET", 1_000_000, 0)];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["ar", "OPERASIONAL"],
      ]),
      kasAwal: 250_000,
    });

    expect(cf.hasCashAccount).toBe(true);
  });

  it("accumulates a credit-normal cash account on the debit-minus-credit orientation", () => {
    /**
     * A bank overdraft (LIABILITAS) overridden to KAS, which the action now
     * refuses but an override stored earlier could still carry.
     * `DR 1101 Kas 10.000.000 / CR 2201 Cerukan 10.000.000` moves no net cash.
     * Read off `signed`, the credit-normal row reports +10.000.000 instead of
     * −10.000.000, so the cash side doubled to +20.000.000 against a
     * `netChange` of 0 and the destructive corruption banner fired permanently
     * on a balanced ledger.
     */
    const rows = [
      row("kas", "1101", "ASET", 10_000_000, 0),
      row("overdraft", "2201", "LIABILITAS", 0, 10_000_000),
    ];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([
        ["kas", "KAS"],
        ["overdraft", "KAS"],
      ]),
      kasAwal: 5_000_000,
    });

    expect(cf.netChange).toBe(0);
    expect(cf.kasAkhirActual).toBe(5_000_000);
    expect(cf.isReconciled).toBe(true);
  });

  it("reports no cash account when none is classified KAS", () => {
    const rows = [row("ar", "1201", "ASET", 1_000_000, 0)];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([["ar", "OPERASIONAL"]]),
      kasAwal: 0,
    });

    expect(cf.hasCashAccount).toBe(false);
  });

  it("flags an unreconciled statement when journal data is corrupt", () => {
    /* Deliberately unbalanced: cash moved with no counterpart anywhere. */
    const rows = [row("kas", "1101", "ASET", 900_000, 0)];
    const cf = buildCashFlow({
      rows,
      sectionByAccountId: sections([["kas", "KAS"]]),
      kasAwal: 0,
    });

    expect(cf.netChange).toBe(0);
    expect(cf.kasAkhirActual).toBe(900_000);
    expect(cf.isReconciled).toBe(false);
  });
});

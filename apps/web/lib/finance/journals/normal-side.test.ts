import { describe, expect, it } from "vitest";
import { isDebitNormal, signedDelta } from "./normal-side";

describe("isDebitNormal", () => {
  it("classifies ASET, HPP, BEBAN as debit-normal", () => {
    expect(isDebitNormal("ASET")).toBe(true);
    expect(isDebitNormal("HPP")).toBe(true);
    expect(isDebitNormal("BEBAN")).toBe(true);
  });

  it("classifies LIABILITAS, EKUITAS, PENDAPATAN as credit-normal", () => {
    expect(isDebitNormal("LIABILITAS")).toBe(false);
    expect(isDebitNormal("EKUITAS")).toBe(false);
    expect(isDebitNormal("PENDAPATAN")).toBe(false);
  });
});

describe("signedDelta", () => {
  it("returns debit minus credit for debit-normal accounts", () => {
    expect(signedDelta("ASET", 100, 0)).toBe(100);
    expect(signedDelta("ASET", 0, 40)).toBe(-40);
    expect(signedDelta("BEBAN", 30, 0)).toBe(30);
  });

  it("returns credit minus debit for credit-normal accounts", () => {
    expect(signedDelta("PENDAPATAN", 0, 100)).toBe(100);
    expect(signedDelta("PENDAPATAN", 40, 0)).toBe(-40);
    expect(signedDelta("LIABILITAS", 0, 50)).toBe(50);
  });

  it("accumulates a running balance over a sequence of lines (ASET account)", () => {
    const lines: Array<{ debit: number; credit: number }> = [
      { debit: 1000, credit: 0 }, // opening deposit
      { debit: 0, credit: 200 }, // withdrawal
      { debit: 500, credit: 0 }, // deposit
      { debit: 0, credit: 1100 }, // withdrawal
    ];
    let runningBalance = 0;
    const balances: number[] = [];
    for (const line of lines) {
      runningBalance += signedDelta("ASET", line.debit, line.credit);
      balances.push(runningBalance);
    }
    expect(balances).toEqual([1000, 800, 1300, 200]);
  });

  it("accumulates a running balance over a sequence of lines (PENDAPATAN account)", () => {
    const lines: Array<{ debit: number; credit: number }> = [
      { debit: 0, credit: 500 },
      { debit: 0, credit: 300 },
      { debit: 100, credit: 0 }, // reversal/correction
    ];
    let runningBalance = 0;
    const balances: number[] = [];
    for (const line of lines) {
      runningBalance += signedDelta("PENDAPATAN", line.debit, line.credit);
      balances.push(runningBalance);
    }
    expect(balances).toEqual([500, 800, 700]);
  });
});

import { describe, expect, it } from "vitest";
import { buildTrialBalance, sisiSaldo } from "./trial-balance";
import type { BalanceRow } from "./balances";

function row(over: Partial<BalanceRow> & { accountId: string; code: string }): BalanceRow {
  return {
    accountId: over.accountId,
    code: over.code,
    name: over.name ?? `Account ${over.code}`,
    type: over.type ?? "ASET",
    parentId: over.parentId ?? null,
    depth: over.depth ?? 0,
    isActive: over.isActive ?? true,
    hasChildren: over.hasChildren ?? false,
    debit: over.debit ?? 0,
    credit: over.credit ?? 0,
    signed: over.signed ?? 0,
  };
}

describe("buildTrialBalance", () => {
  it("hides parent accounts that carry no movement of their own", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, debit: 0, credit: 0 }),
      row({ accountId: "c", code: "1101", parentId: "p", debit: 500, credit: 0, signed: 500 }),
      row({ accountId: "k", code: "2100", type: "LIABILITAS", debit: 0, credit: 500, signed: 500 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.rows.map((r) => r.code)).toEqual(["1101", "2100"]);
    expect(tb.totalDebit).toBe(500);
    expect(tb.totalCredit).toBe(500);
    expect(tb.isBalanced).toBe(true);
  });

  it("keeps a parent that has both its own movement and a child", () => {
    /*
     * An account posted to before it gained a child. Each row carries only its
     * own lines (per-account groupBy), so the parent's 300 is not a rollup of
     * the child's 200 — dropping it would leave debit 200 against credit 500.
     */
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, debit: 300, credit: 0, signed: 300 }),
      row({ accountId: "c", code: "1101", parentId: "p", debit: 200, credit: 0, signed: 200 }),
      row({ accountId: "k", code: "2100", type: "LIABILITAS", debit: 0, credit: 500, signed: 500 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.rows.map((r) => r.code)).toEqual(["1100", "1101", "2100"]);
    const parent = tb.rows.find((r) => r.code === "1100");
    expect(parent).toMatchObject({ debit: 300, credit: 0, signed: 300 });
    expect(tb.totalDebit).toBe(500);
    expect(tb.totalCredit).toBe(500);
    expect(tb.isBalanced).toBe(true);
  });

  it("hides zero-movement rows by default and shows them on request", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 100, credit: 0, signed: 100 }),
      row({ accountId: "b", code: "1102", debit: 0, credit: 0 }),
    ];

    expect(buildTrialBalance(rows).rows.map((r) => r.code)).toEqual(["1101"]);
    expect(buildTrialBalance(rows, { includeZero: true }).rows.map((r) => r.code)).toEqual([
      "1101",
      "1102",
    ]);
  });

  it("reports unbalanced totals instead of hiding them", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 100, credit: 0, signed: 100 }),
      row({ accountId: "b", code: "2100", type: "LIABILITAS", debit: 0, credit: 90, signed: 90 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.totalDebit).toBe(100);
    expect(tb.totalCredit).toBe(90);
    expect(tb.isBalanced).toBe(false);
  });

  it("compares totals at cent precision, tolerating float drift", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 0.1 + 0.2, credit: 0, signed: 0.3 }),
      row({ accountId: "b", code: "2100", type: "LIABILITAS", debit: 0, credit: 0.3, signed: 0.3 }),
    ];

    expect(buildTrialBalance(rows).isBalanced).toBe(true);
  });

  describe("saldo awal dan saldo akhir", () => {
    it("saldo akhir = saldo awal + mutasi bersih, per sisi normal akun", () => {
      const awal: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 5000, credit: 0, signed: 5000 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS", debit: 0, credit: 5000, signed: 5000 }),
      ];
      const periode: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 0, credit: 350, signed: -350 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS" }),
        row({ accountId: "beban", code: "6101", type: "BEBAN", debit: 350, credit: 0, signed: 350 }),
      ];

      const tb = buildTrialBalance(periode, { saldoAwal: awal });

      expect(tb.rows.map((r) => [r.code, r.opening, r.debit, r.credit, r.closing])).toEqual([
        ["1101", 5000, 0, 350, 4650],
        // Tanpa mutasi pada periode, tetapi bersaldo awal: tetap tampil.
        ["3101", 5000, 0, 0, 5000],
        ["6101", 0, 350, 0, 350],
      ]);
      expect(tb.isBalanced).toBe(true);
      expect(tb.adaSaldoAwal).toBe(true);
    });

    it("akun yang hanya ada di saldo awal (nonaktif tanpa mutasi periode) tetap tampil, urut kode", () => {
      const awal: BalanceRow[] = [
        row({ accountId: "lama", code: "1201", isActive: false, debit: 12000, credit: 0, signed: 12000 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS", debit: 0, credit: 12000, signed: 12000 }),
      ];
      const periode: BalanceRow[] = [row({ accountId: "modal", code: "3101", type: "EKUITAS" })];

      const tb = buildTrialBalance(periode, { saldoAwal: awal });

      expect(tb.rows.map((r) => [r.code, r.opening, r.closing])).toEqual([
        ["1201", 12000, 12000],
        ["3101", 12000, 12000],
      ]);
    });

    it("saldo awal yang membulat ke nol tidak memunculkan akun", () => {
      const awal: BalanceRow[] = [row({ accountId: "a", code: "1101", debit: 0.001, credit: 0, signed: 0.001 })];
      const periode: BalanceRow[] = [row({ accountId: "a", code: "1101" })];

      expect(buildTrialBalance(periode, { saldoAwal: awal }).rows).toEqual([]);
    });

    it("tanpa saldo awal (sejak awal), kolom saldo awal nol dan saldo akhir = mutasi", () => {
      const periode: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 100, credit: 0, signed: 100 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS", debit: 0, credit: 100, signed: 100 }),
      ];

      const tb = buildTrialBalance(periode);

      expect(tb.rows.map((r) => [r.code, r.opening, r.closing])).toEqual([
        ["1101", 0, 100],
        ["3101", 0, 100],
      ]);
      expect(tb.adaSaldoAwal).toBe(false);
    });

    it("saldo akhir yang tidak seimbang antar sisi menandai data rusak walau mutasi periode seimbang", () => {
      const awal: BalanceRow[] = [row({ accountId: "kas", code: "1101", debit: 100, credit: 0, signed: 100 })];
      const periode: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 10, credit: 0, signed: 10 }),
        row({ accountId: "hutang", code: "2101", type: "LIABILITAS", debit: 0, credit: 10, signed: 10 }),
      ];

      const tb = buildTrialBalance(periode, { saldoAwal: awal });

      expect(tb.totalDebit).toBe(10);
      expect(tb.totalCredit).toBe(10);
      expect(tb.isBalanced).toBe(false);
    });

    it("Kas yang hanya keluar pada periode tetap positif karena saldo awalnya ikut (temuan audit G8)", () => {
      const awal: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 5000000, credit: 0, signed: 5000000 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS", debit: 0, credit: 5000000, signed: 5000000 }),
      ];
      const periode: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 0, credit: 350000, signed: -350000 }),
        row({ accountId: "beban", code: "6101", type: "BEBAN", debit: 350000, credit: 0, signed: 350000 }),
      ];

      const kas = buildTrialBalance(periode, { saldoAwal: awal }).rows.find((r) => r.code === "1101");

      expect(kas?.closing).toBe(4650000);
    });
  });

  describe("sisi saldo D/K", () => {
    it("menulis sisi sebenarnya, bukan tanda minus", () => {
      expect(sisiSaldo("ASET", 4650000)).toEqual({ jumlah: 4650000, sisi: "D" });
      expect(sisiSaldo("ASET", -350000)).toEqual({ jumlah: 350000, sisi: "K" });
      expect(sisiSaldo("EKUITAS", 147000000)).toEqual({ jumlah: 147000000, sisi: "K" });
      expect(sisiSaldo("LIABILITAS", -10)).toEqual({ jumlah: 10, sisi: "D" });
      expect(sisiSaldo("BEBAN", 0.001)).toEqual({ jumlah: 0, sisi: null });
    });

    it("jumlah saldo awal dan akhir per sisi sama bila buku seimbang", () => {
      const awal: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 5000, credit: 0, signed: 5000 }),
        row({ accountId: "modal", code: "3101", type: "EKUITAS", debit: 0, credit: 5000, signed: 5000 }),
      ];
      const periode: BalanceRow[] = [
        row({ accountId: "kas", code: "1101", debit: 0, credit: 6000, signed: -6000 }),
        row({ accountId: "beban", code: "6101", type: "BEBAN", debit: 6000, credit: 0, signed: 6000 }),
      ];
      const tb = buildTrialBalance(periode, { saldoAwal: awal });
      expect(tb.totalSaldoAwal).toEqual({ debit: 5000, kredit: 5000 });
      // Kas −1000 (sisi kredit) + modal 5000 K = 6000 K; beban 6000 D.
      expect(tb.totalSaldoAkhir).toEqual({ debit: 6000, kredit: 6000 });
    });
  });
});


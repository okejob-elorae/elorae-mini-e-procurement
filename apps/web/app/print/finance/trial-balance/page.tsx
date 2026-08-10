"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getTrialBalanceReport } from "@/app/actions/finance-reports";
import {
  TRIAL_BALANCE_BALANCED_NOTE,
  TRIAL_BALANCE_UNBALANCED_NOTE,
} from "@/lib/finance/reports/disclosures";

type Report = Awaited<ReturnType<typeof getTrialBalanceReport>>;

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export default function PrintTrialBalancePage() {
  const sp = useSearchParams();
  const printedRef = useRef(false);
  const [report, setReport] = useState<Report | "error" | null>(null);

  useEffect(() => {
    getTrialBalanceReport({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      includeZero: sp.get("zero") === "1",
    })
      .then(setReport)
      .catch(() => setReport("error"));
  }, [sp]);

  useEffect(() => {
    if (!report || report === "error" || printedRef.current) return;
    printedRef.current = true;
    /**
     * Delay so the DOM is fully rendered before the print dialog opens — the
     * sibling work-order print view learned this from a real failure. Teardown
     * releases the guard so a Strict Mode double-invocation still prints once
     * (first timer cancelled, second one fires).
     */
    const timer = setTimeout(() => {
      window.print();
    }, 400);
    return () => {
      clearTimeout(timer);
      printedRef.current = false;
    };
  }, [report]);

  if (!report) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (report === "error") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-1 text-center">
        <p className="font-bold">Gagal memuat laporan.</p>
        <p className="text-sm text-gray-600">
          Anda mungkin tidak memiliki akses ke laporan keuangan. Tutup tab ini dan kembali.
        </p>
      </div>
    );
  }

  return (
    <div className="print-statement mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Neraca Saldo</h2>
        <p className="text-sm">{report.periodLabel}</p>
        <p className="mt-1 text-xs text-gray-600">Disiapkan oleh: {report.preparedBy}</p>
        <p className="text-xs text-gray-600">Dicetak: {report.printedAt}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Kode</th>
            <th className="py-1 text-left">Nama Akun</th>
            <th className="py-1 text-right">Debit</th>
            <th className="py-1 text-right">Kredit</th>
            <th className="py-1 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.accountId} className="border-b border-gray-200">
              <td className="py-1 font-mono text-xs">{row.code}</td>
              <td className="py-1">{row.name}</td>
              <td className="py-1 text-right">{formatRupiah(row.debit)}</td>
              <td className="py-1 text-right">{formatRupiah(row.credit)}</td>
              <td className="py-1 text-right">{formatRupiah(row.signed)}</td>
            </tr>
          ))}
          <tr className="border-t border-black font-semibold">
            <td className="py-1" colSpan={2}>
              Total
            </td>
            <td className="py-1 text-right">{formatRupiah(report.totalDebit)}</td>
            <td className="py-1 text-right">{formatRupiah(report.totalCredit)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="mt-4 text-xs text-gray-700">
        {report.isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getTrialBalanceReport } from "@/app/actions/finance-reports";

type Report = Awaited<ReturnType<typeof getTrialBalanceReport>>;

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export default function PrintTrialBalancePage() {
  const sp = useSearchParams();
  const printedRef = useRef(false);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    getTrialBalanceReport({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      includeZero: sp.get("zero") === "1",
    }).then(setReport);
  }, [sp]);

  useEffect(() => {
    if (report && !printedRef.current) {
      printedRef.current = true;
      window.print();
    }
  }, [report]);

  if (!report) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Neraca Saldo</h2>
        <p className="text-sm">{report.periodLabel}</p>
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
    </div>
  );
}

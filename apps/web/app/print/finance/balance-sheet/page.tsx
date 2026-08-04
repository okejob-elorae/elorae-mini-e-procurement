"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBalanceSheetReport } from "@/app/actions/finance-reports";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import {
  BALANCE_SHEET_OPENING_TITLE,
  balanceSheetOpeningBody,
  formatOpeningDate,
} from "@/lib/finance/reports/disclosures";

type Report = Awaited<ReturnType<typeof getBalanceSheetReport>>;

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function nodeRows(nodes: RollupNode[], level = 0): React.ReactNode[] {
  return nodes.flatMap((node) => [
    <tr key={node.accountId} className="border-b border-gray-200">
      <td className="py-1" style={{ paddingLeft: `${level * 16}px` }}>
        <span className="font-mono text-xs text-gray-500">{node.code}</span> {node.name}
      </td>
      <td className="py-1 text-right">{formatRupiah(node.subtotal)}</td>
    </tr>,
    ...nodeRows(node.children, level + 1),
  ]);
}

export default function PrintBalanceSheetPage() {
  const sp = useSearchParams();
  const printedRef = useRef(false);
  const [report, setReport] = useState<Report | "error" | null>(null);

  useEffect(() => {
    getBalanceSheetReport({ asOf: sp.get("asOf") ?? undefined })
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
    <div className="print-statement mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Neraca</h2>
        <p className="text-sm">{report.periodLabel}</p>
        <p className="mt-1 text-xs text-gray-600">Disiapkan oleh: {report.preparedBy}</p>
        <p className="text-xs text-gray-600">Dicetak: {report.printedAt}</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="print-statement-band bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              ASET
            </td>
          </tr>
          {nodeRows(report.aset)}
          <tr className="font-semibold">
            <td className="py-1">Total Aset</td>
            <td className="py-1 text-right">{formatRupiah(report.totalAset)}</td>
          </tr>
          <tr className="print-statement-band bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              LIABILITAS
            </td>
          </tr>
          {nodeRows(report.liabilitas)}
          <tr className="font-semibold">
            <td className="py-1">Total Liabilitas</td>
            <td className="py-1 text-right">{formatRupiah(report.totalLiabilitas)}</td>
          </tr>
          <tr className="print-statement-band bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              EKUITAS
            </td>
          </tr>
          {nodeRows(report.ekuitas)}
          <tr className="font-semibold">
            <td className="py-1">Total Ekuitas</td>
            <td className="py-1 text-right">{formatRupiah(report.totalEkuitas)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1 pl-4">Laba (Rugi) Belum Ditutup</td>
            <td className="py-1 text-right">{formatRupiah(report.unclosedEarnings)}</td>
          </tr>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Total Liabilitas dan Ekuitas</td>
            <td className="py-1 text-right">{formatRupiah(report.totalLiabilitasEkuitas)}</td>
          </tr>
        </tbody>
      </table>
      {report.openingWarningDate && (
        <div className="mt-4 text-xs text-gray-700">
          <p className="font-semibold">{BALANCE_SHEET_OPENING_TITLE}</p>
          <p>{balanceSheetOpeningBody(formatOpeningDate(report.openingWarningDate))}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBalanceSheetReport } from "@/app/actions/finance-reports";
import type { RollupNode } from "@/lib/finance/reports/rollup";

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
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    getBalanceSheetReport({ asOf: sp.get("asOf") ?? undefined }).then(setReport);
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
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Neraca</h2>
        <p className="text-sm">{report.periodLabel}</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              ASET
            </td>
          </tr>
          {nodeRows(report.aset)}
          <tr className="font-semibold">
            <td className="py-1">Total Aset</td>
            <td className="py-1 text-right">{formatRupiah(report.totalAset)}</td>
          </tr>
          <tr className="bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              LIABILITAS
            </td>
          </tr>
          {nodeRows(report.liabilitas)}
          <tr className="font-semibold">
            <td className="py-1">Total Liabilitas</td>
            <td className="py-1 text-right">{formatRupiah(report.totalLiabilitas)}</td>
          </tr>
          <tr className="bg-gray-100 font-semibold">
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
    </div>
  );
}

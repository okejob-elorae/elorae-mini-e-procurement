"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getIncomeStatementReport } from "@/app/actions/finance-reports";
import type { RollupNode } from "@/lib/finance/reports/rollup";

type Report = Awaited<ReturnType<typeof getIncomeStatementReport>>;

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

export default function PrintIncomeStatementPage() {
  const sp = useSearchParams();
  const printedRef = useRef(false);
  const [report, setReport] = useState<Report | "error" | null>(null);

  useEffect(() => {
    getIncomeStatementReport({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    })
      .then(setReport)
      .catch(() => setReport("error"));
  }, [sp]);

  useEffect(() => {
    if (report && report !== "error" && !printedRef.current) {
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
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Laporan Laba Rugi</h2>
        <p className="text-sm">{report.periodLabel}</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              PENDAPATAN
            </td>
          </tr>
          {nodeRows(report.pendapatan)}
          <tr className="font-semibold">
            <td className="py-1">Total Pendapatan</td>
            <td className="py-1 text-right">{formatRupiah(report.totalPendapatan)}</td>
          </tr>
          <tr className="bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              HARGA POKOK PENJUALAN
            </td>
          </tr>
          {nodeRows(report.hpp)}
          <tr className="font-semibold">
            <td className="py-1">Total Harga Pokok Penjualan</td>
            <td className="py-1 text-right">{formatRupiah(report.totalHpp)}</td>
          </tr>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Laba Kotor</td>
            <td className="py-1 text-right">{formatRupiah(report.labaKotor)}</td>
          </tr>
          <tr className="bg-gray-100 font-semibold">
            <td className="py-1" colSpan={2}>
              BEBAN OPERASIONAL
            </td>
          </tr>
          {nodeRows(report.beban)}
          <tr className="font-semibold">
            <td className="py-1">Total Beban Operasional</td>
            <td className="py-1 text-right">{formatRupiah(report.totalBeban)}</td>
          </tr>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Laba Bersih</td>
            <td className="py-1 text-right">{formatRupiah(report.labaBersih)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getCashFlowReport } from "@/app/actions/finance-reports";
import type { CashFlowLine } from "@/lib/finance/reports/cash-flow";
import {
  CASH_FLOW_COVERAGE_BODY,
  CASH_FLOW_COVERAGE_TITLE,
  CASH_FLOW_NO_CASH_ACCOUNT_NOTE,
  CASH_FLOW_RECONCILED_NOTE,
  CASH_FLOW_UNCLASSIFIED_BODY,
  CASH_FLOW_UNCLASSIFIED_TITLE,
  CASH_FLOW_UNRECONCILED_NOTE,
} from "@/lib/finance/reports/disclosures";

type Report = Awaited<ReturnType<typeof getCashFlowReport>>;

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function lineRows(lines: CashFlowLine[]): React.ReactNode[] {
  return lines.map((line) => (
    <tr key={line.accountId} className="border-b border-gray-200">
      <td className="py-1 pl-4">
        <span className="font-mono text-xs text-gray-500">{line.code}</span> {line.name}
      </td>
      <td className="py-1 text-right">{formatRupiah(line.amount)}</td>
    </tr>
  ));
}

function band(label: string): React.ReactNode {
  return (
    <tr className="print-statement-band bg-gray-100 font-semibold">
      <td className="py-1" colSpan={2}>
        {label}
      </td>
    </tr>
  );
}

function totalRow(label: string, value: number, strong = false): React.ReactNode {
  return (
    <tr className={strong ? "border-t-2 border-black font-bold" : "font-semibold"}>
      <td className="py-1">{label}</td>
      <td className="py-1 text-right">{formatRupiah(value)}</td>
    </tr>
  );
}

export default function PrintCashFlowPage() {
  const sp = useSearchParams();
  const printedRef = useRef(false);
  const [report, setReport] = useState<Report | "error" | null>(null);

  useEffect(() => {
    getCashFlowReport({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    })
      .then(setReport)
      .catch(() => setReport("error"));
  }, [sp]);

  useEffect(() => {
    if (!report || report === "error" || printedRef.current) return;
    printedRef.current = true;
    /**
     * Delay so the DOM is fully rendered before the print dialog opens — the
     * sibling statement print views learned this from a real failure. Teardown
     * releases the guard so a Strict Mode double-invocation still prints once.
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

  if (!report.hasCashAccount) {
    return (
      <div className="print-statement mx-auto max-w-2xl text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Laporan Arus Kas</h2>
        <p className="mt-4 text-sm">{CASH_FLOW_NO_CASH_ACCOUNT_NOTE}</p>
      </div>
    );
  }

  return (
    <div className="print-statement mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold">Elorae</h1>
        <h2 className="text-base font-semibold">Laporan Arus Kas</h2>
        <p className="text-sm">{report.periodLabel}</p>
        <p className="mt-1 text-xs text-gray-600">Disiapkan oleh: {report.preparedBy}</p>
        <p className="text-xs text-gray-600">Dicetak: {report.printedAt}</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {band("ARUS KAS DARI AKTIVITAS OPERASIONAL")}
          <tr className="border-b border-gray-200">
            <td className="py-1 pl-4">Laba Bersih</td>
            <td className="py-1 text-right">{formatRupiah(report.labaBersih)}</td>
          </tr>
          {lineRows(report.operasional)}
          {totalRow("Kas Bersih dari Aktivitas Operasional", report.totalOperasional)}
          {band("ARUS KAS DARI AKTIVITAS INVESTASI")}
          {lineRows(report.investasi)}
          {totalRow("Kas Bersih dari Aktivitas Investasi", report.totalInvestasi)}
          {band("ARUS KAS DARI AKTIVITAS PENDANAAN")}
          {lineRows(report.pendanaan)}
          {totalRow("Kas Bersih dari Aktivitas Pendanaan", report.totalPendanaan)}
          {report.unclassified.length > 0 && (
            <>
              {band("BELUM DIKLASIFIKASI")}
              {lineRows(report.unclassified)}
              {totalRow("Total Belum Diklasifikasi", report.totalUnclassified)}
            </>
          )}
          {totalRow("Kenaikan (Penurunan) Kas", report.netChange, true)}
          <tr className="border-b border-gray-200">
            <td className="py-1 pl-4">Kas Awal Periode</td>
            <td className="py-1 text-right">{formatRupiah(report.kasAwal)}</td>
          </tr>
          {totalRow("Kas Akhir Periode", report.kasAkhir, true)}
        </tbody>
      </table>
      <div className="mt-4 text-xs text-gray-700">
        <p>{report.isReconciled ? CASH_FLOW_RECONCILED_NOTE : CASH_FLOW_UNRECONCILED_NOTE}</p>
      </div>
      {report.unclassified.length > 0 && (
        <div className="mt-3 text-xs text-gray-700">
          <p className="font-semibold">{CASH_FLOW_UNCLASSIFIED_TITLE}</p>
          <p>{CASH_FLOW_UNCLASSIFIED_BODY}</p>
        </div>
      )}
      <div className="mt-3 text-xs text-gray-700">
        <p className="font-semibold">{CASH_FLOW_COVERAGE_TITLE}</p>
        <p>{CASH_FLOW_COVERAGE_BODY}</p>
      </div>
    </div>
  );
}

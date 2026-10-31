"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { logPrintQuietly } from "@/lib/audit/log-print-quietly";
import { getIncomeStatementReport } from "@/app/actions/finance-reports";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, barisPohonCetak, useCetakOtomatis } from "../cetak-laporan";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import { barisPohon, dariRollup } from "@/lib/finance/reports/tampil-pohon";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { INCOME_STATEMENT_EMPTY_NOTE } from "@/lib/finance/reports/disclosures";
import { adaMutasiLabaRugi } from "@/app/backoffice/finance/_kesiapan/kesiapan";

type Report = Awaited<ReturnType<typeof getIncomeStatementReport>>;

function Bagian({ judul, nodes, total, labelTotal, nol }: { judul: string; nodes: RollupNode[]; total: number; labelTotal: string; nol: boolean }) {
  return (
    <>
      <tr className="print-statement-band bg-gray-100 font-semibold">
        <td className="py-1" colSpan={3}>
          {judul}
        </td>
      </tr>
      {barisPohonCetak(barisPohon(dariRollup(nodes), { tampilkanNol: nol }))}
      <tr className="font-semibold">
        <td className="py-1">{labelTotal}</td>
        <td />
        <td className="border-t border-gray-400 py-1 text-right">{rupiahLaporan(total)}</td>
      </tr>
    </>
  );
}

function BarisLaba({ label, nilai }: { label: string; nilai: number }) {
  return (
    <tr className="border-t-2 border-black font-bold">
      <td className="py-1">{label}</td>
      <td />
      <td className="py-1 text-right">{rupiahLaporan(nilai)}</td>
    </tr>
  );
}

export default function PrintIncomeStatementPage() {
  const sp = useSearchParams();
  const nol = sp.get("nol") === "1" || sp.get("zero") === "1";
  const [report, setReport] = useState<Report | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([
      getIncomeStatementReport({
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        includeZero: nol,
      }),
      bacaKesiapanCetakAction().catch(() => null),
    ])
      .then(([r, k]) => {
        setKesiapan(k);
        setReport(r);
      })
      .catch(() => setReport("error"));
  }, [sp, nol]);

  useCetakOtomatis(!!report && report !== "error");

  const loggedRef = useRef(false);
  useEffect(() => {
    if (!report || report === "error" || loggedRef.current) return;
    loggedRef.current = true;
    logPrintQuietly("IncomeStatement", report.periodLabel);
  }, [report]);

  if (!report) return <MemuatCetak />;
  if (report === "error") return <GagalCetak />;

  return (
    <div className="print-statement mx-auto max-w-2xl">
      <KepalaCetak judul="Laporan Laba Rugi" periode={report.periodLabel} disiapkanOleh={report.preparedBy} dicetak={report.printedAt} />
      <CatatanBukuBesar kesiapan={kesiapan} />
      {!adaMutasiLabaRugi(report) ? (
        <p className="py-6 text-center text-sm">{INCOME_STATEMENT_EMPTY_NOTE}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black">
              <th className="py-1 text-left">Keterangan</th>
              <th className="w-32 py-1 text-right">Rincian</th>
              <th className="w-32 py-1 text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <Bagian judul="PENDAPATAN" nodes={report.pendapatan} total={report.totalPendapatan} labelTotal="Total Pendapatan" nol={nol} />
            <Bagian judul="HARGA POKOK PENJUALAN" nodes={report.hpp} total={report.totalHpp} labelTotal="Total Harga Pokok Penjualan" nol={nol} />
            <BarisLaba label="Laba Kotor" nilai={report.labaKotor} />
            <Bagian judul="BEBAN OPERASIONAL" nodes={report.beban} total={report.totalBeban} labelTotal="Total Beban Operasional" nol={nol} />
            <BarisLaba label="Laba Bersih" nilai={report.labaBersih} />
          </tbody>
        </table>
      )}
      <div className="mt-4 text-xs text-gray-700">
        <p className="font-semibold">{report.notes.coverageTitle}</p>
        <p>{report.notes.coverageBody}</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getBalanceSheetReport } from "@/app/actions/finance-reports";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, barisPohonCetak, useCetakOtomatis } from "../cetak-laporan";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import { barisPohon, dariRollup } from "@/lib/finance/reports/tampil-pohon";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import {
  BALANCE_SHEET_COVERAGE_BODY,
  BALANCE_SHEET_COVERAGE_TITLE,
  BALANCE_SHEET_EMPTY_NOTE,
  BALANCE_SHEET_OPENING_TITLE,
  balanceSheetOpeningBody,
  formatOpeningDate,
} from "@/lib/finance/reports/disclosures";
import { adaMutasiPohon } from "@/app/backoffice/finance/_kesiapan/kesiapan";

type Report = Awaited<ReturnType<typeof getBalanceSheetReport>>;

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

export default function PrintBalanceSheetPage() {
  const sp = useSearchParams();
  const nol = sp.get("nol") === "1";
  const [report, setReport] = useState<Report | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([getBalanceSheetReport({ asOf: sp.get("asOf") ?? undefined }), bacaKesiapanCetakAction().catch(() => null)])
      .then(([r, k]) => {
        setKesiapan(k);
        setReport(r);
      })
      .catch(() => setReport("error"));
  }, [sp]);

  useCetakOtomatis(!!report && report !== "error");

  if (!report) return <MemuatCetak />;
  if (report === "error") return <GagalCetak />;

  return (
    <div className="print-statement mx-auto max-w-2xl">
      <KepalaCetak judul="Neraca" periode={report.periodLabel} disiapkanOleh={report.preparedBy} dicetak={report.printedAt} />
      <CatatanBukuBesar kesiapan={kesiapan} />
      {!adaMutasiPohon([...report.aset, ...report.liabilitas, ...report.ekuitas]) && report.unclosedEarnings === 0 ? (
        <p className="py-6 text-center text-sm">{BALANCE_SHEET_EMPTY_NOTE}</p>
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
            <Bagian judul="ASET" nodes={report.aset} total={report.totalAset} labelTotal="Total Aset" nol={nol} />
            <Bagian judul="LIABILITAS" nodes={report.liabilitas} total={report.totalLiabilitas} labelTotal="Total Liabilitas" nol={nol} />
            <Bagian judul="EKUITAS" nodes={report.ekuitas} total={report.totalEkuitas} labelTotal="Total Ekuitas" nol={nol} />
            {report.labaTahunLaluBelumDitutup !== 0 ? (
              <tr className="border-b border-gray-200">
                <td className="py-1 pl-4">Laba (Rugi) Tahun Lalu Belum Ditutup</td>
                <td />
                <td className="py-1 text-right">{rupiahLaporan(report.labaTahunLaluBelumDitutup)}</td>
              </tr>
            ) : null}
            <tr className="border-b border-gray-200">
              <td className="py-1 pl-4">Laba (Rugi) Tahun Berjalan</td>
              <td />
              <td className="py-1 text-right">{rupiahLaporan(report.labaTahunBerjalan)}</td>
            </tr>
            <tr className="border-t-2 border-black font-bold">
              <td className="py-1">Total Liabilitas dan Ekuitas</td>
              <td />
              <td className="py-1 text-right">{rupiahLaporan(report.totalLiabilitasEkuitas)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {report.openingWarningDate && (
        <div className="mt-4 text-xs text-gray-700">
          <p className="font-semibold">{BALANCE_SHEET_OPENING_TITLE}</p>
          <p>{balanceSheetOpeningBody(formatOpeningDate(report.openingWarningDate))}</p>
        </div>
      )}
      <div className="mt-4 text-xs text-gray-700">
        <p className="font-semibold">{BALANCE_SHEET_COVERAGE_TITLE}</p>
        <p>{BALANCE_SHEET_COVERAGE_BODY}</p>
      </div>
    </div>
  );
}

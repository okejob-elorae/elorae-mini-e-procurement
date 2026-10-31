"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { logPrintQuietly } from "@/lib/audit/log-print-quietly";
import { getTrialBalanceReport } from "@/app/actions/finance-reports";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, useCetakOtomatis } from "../cetak-laporan";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { sisiSaldo } from "@/lib/finance/reports/trial-balance";
import type { AccountType } from "@/lib/constants/enums";
import {
  TRIAL_BALANCE_BALANCED_NOTE,
  TRIAL_BALANCE_UNBALANCED_NOTE,
  REPORT_EMPTY_PERIOD_NOTE,
} from "@/lib/finance/reports/disclosures";

type Report = Awaited<ReturnType<typeof getTrialBalanceReport>>;

/** Saldo + sisi sebenarnya (D/K), sama dengan layar dan Excel. */
function saldo(type: AccountType, nilai: number): string {
  const s = sisiSaldo(type, nilai);
  return s.sisi ? `${rupiahLaporan(s.jumlah)} ${s.sisi}` : rupiahLaporan(0);
}

export default function PrintTrialBalancePage() {
  const sp = useSearchParams();
  const [report, setReport] = useState<Report | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([
      getTrialBalanceReport({
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        includeZero: sp.get("zero") === "1",
      }),
      bacaKesiapanCetakAction().catch(() => null),
    ])
      .then(([r, k]) => {
        setKesiapan(k);
        setReport(r);
      })
      .catch(() => setReport("error"));
  }, [sp]);

  useCetakOtomatis(!!report && report !== "error");

  const loggedRef = useRef(false);
  useEffect(() => {
    if (!report || report === "error" || loggedRef.current) return;
    loggedRef.current = true;
    logPrintQuietly("TrialBalanceStatement", report.periodLabel);
  }, [report]);

  if (!report) return <MemuatCetak />;
  if (report === "error") return <GagalCetak />;

  return (
    <div className="print-statement mx-auto max-w-3xl">
      <KepalaCetak judul="Neraca Saldo" periode={report.periodLabel} disiapkanOleh={report.preparedBy} dicetak={report.printedAt} />
      <CatatanBukuBesar kesiapan={kesiapan} />
      {report.rows.length === 0 ? (
        <p className="py-6 text-center text-sm">{REPORT_EMPTY_PERIOD_NOTE}</p>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black">
                <th className="py-1 text-left">Kode</th>
                <th className="py-1 text-left">Nama akun</th>
                <th className="py-1 text-right">Saldo awal</th>
                <th className="py-1 text-right">Debit</th>
                <th className="py-1 text-right">Kredit</th>
                <th className="py-1 text-right">Saldo akhir</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-gray-200">
                  <td className="py-1 font-mono">{row.code}</td>
                  <td className="py-1">{row.name}</td>
                  <td className="py-1 text-right">{saldo(row.type, row.opening)}</td>
                  <td className="py-1 text-right">{rupiahLaporan(row.debit)}</td>
                  <td className="py-1 text-right">{rupiahLaporan(row.credit)}</td>
                  <td className="py-1 text-right">{saldo(row.type, row.closing)}</td>
                </tr>
              ))}
              <tr className="border-t border-black font-semibold">
                <td className="py-1" colSpan={3}>
                  Total mutasi
                </td>
                <td className="py-1 text-right">{rupiahLaporan(report.totalDebit)}</td>
                <td className="py-1 text-right">{rupiahLaporan(report.totalCredit)}</td>
                <td />
              </tr>
              <tr>
                <td className="py-1" colSpan={2}>
                  Jumlah saldo di sisi debit
                </td>
                <td className="py-1 text-right">{rupiahLaporan(report.totalSaldoAwal.debit)} D</td>
                <td colSpan={2} />
                <td className="py-1 text-right">{rupiahLaporan(report.totalSaldoAkhir.debit)} D</td>
              </tr>
              <tr>
                <td className="py-1" colSpan={2}>
                  Jumlah saldo di sisi kredit
                </td>
                <td className="py-1 text-right">{rupiahLaporan(report.totalSaldoAwal.kredit)} K</td>
                <td colSpan={2} />
                <td className="py-1 text-right">{rupiahLaporan(report.totalSaldoAkhir.kredit)} K</td>
              </tr>
            </tbody>
          </table>
          {(report.totalDebit !== 0 || report.totalCredit !== 0 || report.adaSaldoAwal) && (
            <p className="mt-4 text-xs text-gray-700">
              {report.isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE}
            </p>
          )}
        </>
      )}
    </div>
  );
}

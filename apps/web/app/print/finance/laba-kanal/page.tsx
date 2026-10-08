"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getLabaKanalAction, type LaporanLabaKanalAksi } from "@/app/actions/finance-laporan";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, useCetakOtomatis } from "../cetak-laporan";
import type { BarisLabaKanal } from "@/lib/finance/reports/laba-kanal";
import { labelKanalJurnal } from "@/lib/finance/journals/kanal";
import { persenLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { CAKUPAN_LAPORAN_BODY } from "@/lib/finance/reports/disclosures";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";

const tgl = (s: string) => formatDisplayDate(parseDateOnly(s));

function Sel({ b }: { b: BarisLabaKanal }) {
  return (
    <>
      <td className="py-1 text-right">{rupiahLaporan(b.penjualan)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.retur)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.potongan)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.pendapatanBersih)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.hpp)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.labaKotor)}</td>
      <td className="py-1 text-right">{persenLaporan(b.marginKotor)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.beban)}</td>
      <td className="py-1 text-right">{rupiahLaporan(b.labaKontribusi)}</td>
    </>
  );
}

export default function PrintLabaKanalPage() {
  const sp = useSearchParams();
  const [r, setR] = useState<LaporanLabaKanalAksi | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([
      getLabaKanalAction({
        dari: sp.get("dari") ?? undefined,
        sampai: sp.get("sampai") ?? undefined,
        kelompok: sp.get("kelompok") ?? undefined,
        kanal: sp.get("kanal") ?? undefined,
      }),
      bacaKesiapanCetakAction().catch(() => null),
    ])
      .then(([h, k]) => {
        setKesiapan(k);
        setR(h.ok ? h : "error");
      })
      .catch(() => setR("error"));
  }, [sp]);

  useCetakOtomatis(!!r && r !== "error");

  if (!r) return <MemuatCetak />;
  if (r === "error") return <GagalCetak />;

  const perToko = r.kelompok === "toko";
  const label = (k: string | null) => (perToko ? (k ? (r.namaToko[k] ?? k) : "Tanpa toko") : labelKanalJurnal(k));

  return (
    <div className="mx-auto max-w-[277mm]">
      <KepalaCetak
        judul={perToko ? "Laba per Toko" : "Laba per Kanal"}
        periode={`Periode ${tgl(r.periode.dari)} – ${tgl(r.periode.sampai)}${r.kanal ? ` · Kanal ${labelKanalJurnal(r.kanal)}` : ""}`}
        disiapkanOleh={r.disiapkanOleh}
        dicetak={r.dicetak}
      />
      <CatatanBukuBesar kesiapan={kesiapan} />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">{perToko ? "Toko" : "Kanal"}</th>
            <th className="py-1 text-right">Penjualan</th>
            <th className="py-1 text-right">Retur</th>
            <th className="py-1 text-right">Potongan</th>
            <th className="py-1 text-right">Pendapatan bersih</th>
            <th className="py-1 text-right">HPP</th>
            <th className="py-1 text-right">Laba kotor</th>
            <th className="py-1 text-right">Margin</th>
            <th className="py-1 text-right">Beban kanal</th>
            <th className="py-1 text-right">Laba kontribusi</th>
          </tr>
        </thead>
        <tbody>
          {r.baris.map((b) => (
            <tr key={b.kunci ?? "tanpa"} className="border-b border-gray-200">
              <td className="py-1">{label(b.kunci)}</td>
              <Sel b={b} />
            </tr>
          ))}
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Total</td>
            <Sel b={r.total} />
          </tr>
        </tbody>
      </table>
      <div className="mt-4 text-xs text-gray-700">
        <p>
          Baris tanpa kanal/toko berisi beban umum dan jurnal yang belum membawa kanal; total semua baris sama dengan laba bersih Laba Rugi periode yang sama.
          {r.barisTurunan > 0 ? ` ${r.barisTurunan} baris jurnal lama diberi kanal dari dokumen sumbernya.` : ""}
        </p>
        <p className="mt-2 font-semibold">Cakupan data</p>
        <p>{CAKUPAN_LAPORAN_BODY}</p>
      </div>
    </div>
  );
}

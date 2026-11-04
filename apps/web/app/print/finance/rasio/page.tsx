"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRasioAction, type LaporanRasioAksi } from "@/app/actions/finance-laporan";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, useCetakOtomatis } from "../cetak-laporan";
import type { HasilRasio } from "@/lib/finance/reports/rasio";
import { hariLaporan, persenLaporan, rasioLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { CAKUPAN_LAPORAN_BODY } from "@/lib/finance/reports/cakupan-laporan";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import type { RentangTanggal } from "@/lib/finance/reports/periode-banding";

const tgl = (s: string) => formatDisplayDate(parseDateOnly(s));
const rentang = (r: RentangTanggal) => `${tgl(r.dari)} – ${tgl(r.sampai)}`;

const RASIO: [string, (r: HasilRasio) => string][] = [
  ["Margin laba kotor", (r) => persenLaporan(r.marginKotor)],
  ["Margin laba bersih", (r) => persenLaporan(r.marginBersih)],
  ["Rasio lancar", (r) => rasioLaporan(r.rasioLancar)],
  ["Rasio cepat", (r) => rasioLaporan(r.rasioCepat)],
  ["Perputaran persediaan", (r) => rasioLaporan(r.perputaranPersediaan)],
  ["Umur persediaan", (r) => hariLaporan(r.hariPersediaan)],
  ["Umur piutang (DSO)", (r) => hariLaporan(r.dso)],
  ["Umur utang (DPO)", (r) => hariLaporan(r.dpo)],
];

const KOMPONEN: [string, keyof HasilRasio["komponen"]][] = [
  ["Pendapatan bersih", "pendapatan"],
  ["Harga pokok penjualan", "hpp"],
  ["Laba kotor", "labaKotor"],
  ["Laba bersih", "labaBersih"],
  ["Aset lancar (akhir)", "asetLancar"],
  ["Persediaan (akhir)", "persediaan"],
  ["Dibayar dimuka (akhir)", "dibayarDimuka"],
  ["Aset cepat (akhir)", "asetCepat"],
  ["Liabilitas lancar (akhir)", "liabilitasLancar"],
  ["Rata-rata persediaan", "rataPersediaan"],
  ["Rata-rata piutang dagang", "rataPiutang"],
  ["Rata-rata utang usaha", "rataHutang"],
];

export default function PrintRasioPage() {
  const sp = useSearchParams();
  const [r, setR] = useState<LaporanRasioAksi | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([getRasioAction({ dari: sp.get("dari") ?? undefined, sampai: sp.get("sampai") ?? undefined }), bacaKesiapanCetakAction().catch(() => null)])
      .then(([h, k]) => {
        setKesiapan(k);
        setR(h.ok ? h : "error");
      })
      .catch(() => setR("error"));
  }, [sp]);

  useCetakOtomatis(!!r && r !== "error");

  if (!r) return <MemuatCetak />;
  if (r === "error") return <GagalCetak />;

  return (
    <div className="print-statement mx-auto max-w-2xl">
      <KepalaCetak judul="Rasio Keuangan" periode={`Periode ${rentang(r.periode)}`} disiapkanOleh={r.disiapkanOleh} dicetak={r.dicetak} />
      <CatatanBukuBesar kesiapan={kesiapan} />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Rasio</th>
            <th className="py-1 text-right">{rentang(r.periode)}</th>
            <th className="py-1 text-right">{rentang(r.sebelumnya)}</th>
          </tr>
        </thead>
        <tbody>
          {RASIO.map(([label, f]) => (
            <tr key={label} className="border-b border-gray-200">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right font-semibold">{f(r.ini)}</td>
              <td className="py-1 text-right">{f(r.lalu)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Komponen</th>
            <th className="py-1 text-right">{rentang(r.periode)}</th>
            <th className="py-1 text-right">{rentang(r.sebelumnya)}</th>
          </tr>
        </thead>
        <tbody>
          {KOMPONEN.map(([label, k]) => (
            <tr key={k} className="border-b border-gray-200">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right">{rupiahLaporan(r.ini.komponen[k] as number)}</td>
              <td className="py-1 text-right">{rupiahLaporan(r.lalu.komponen[k] as number)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1">Jumlah hari</td>
            <td className="py-1 text-right">{hariLaporan(r.ini.komponen.hari)}</td>
            <td className="py-1 text-right">{hariLaporan(r.lalu.komponen.hari)}</td>
          </tr>
        </tbody>
      </table>
      {r.ini.komponen.akunTakTerklasifikasi > 0 ? (
        <p className="mt-4 text-xs text-gray-700">
          {r.ini.komponen.akunTakTerklasifikasi} akun aset belum diklasifikasi di Klasifikasi Arus Kas dan tidak dihitung sebagai aset lancar.
        </p>
      ) : null}
      <div className="mt-4 text-xs text-gray-700">
        <p className="font-semibold">Cakupan data</p>
        <p>{CAKUPAN_LAPORAN_BODY}</p>
      </div>
    </div>
  );
}

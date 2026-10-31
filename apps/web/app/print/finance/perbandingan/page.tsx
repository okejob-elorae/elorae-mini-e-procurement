"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getPerbandinganLabaRugiAction,
  getPerbandinganNeracaAction,
  type LaporanPerbandinganLabaRugi,
  type LaporanPerbandinganNeraca,
} from "@/app/actions/finance-laporan";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, useCetakOtomatis } from "../cetak-laporan";
import { barisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import { persenLaporan, rupiahLaporan, selisihPersen } from "@/lib/finance/reports/format-laporan";
import { CAKUPAN_LAPORAN_BODY } from "@/lib/finance/reports/cakupan-laporan";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import type { RentangTanggal } from "@/lib/finance/reports/periode-banding";

type Hasil = { jenis: "laba-rugi"; r: LaporanPerbandinganLabaRugi } | { jenis: "neraca"; r: LaporanPerbandinganNeraca };

const tgl = (s: string) => formatDisplayDate(parseDateOnly(s));
const rentang = (r: RentangTanggal) => `${tgl(r.dari)} – ${tgl(r.sampai)}`;

function Sel({ nilai, tebal }: { nilai: number[]; tebal?: boolean }) {
  const a = selisihPersen(nilai[0] ?? 0, nilai[1] ?? 0);
  const b = selisihPersen(nilai[0] ?? 0, nilai[2] ?? 0);
  const k = `py-1 text-right ${tebal ? "font-semibold" : ""}`;
  return (
    <>
      <td className={k}>{rupiahLaporan(nilai[0])}</td>
      <td className={k}>{rupiahLaporan(nilai[1])}</td>
      <td className={k}>{rupiahLaporan(a.selisih)}</td>
      <td className={k}>{persenLaporan(a.persen)}</td>
      <td className={k}>{rupiahLaporan(nilai[2])}</td>
      <td className={k}>{rupiahLaporan(b.selisih)}</td>
      <td className={k}>{persenLaporan(b.persen)}</td>
    </>
  );
}

function Bagian({ judul, akar, total, labelTotal, nol }: { judul: string; akar: SimpulNilai[]; total: number[]; labelTotal: string; nol: boolean }) {
  return (
    <>
      <tr className="print-statement-band bg-gray-100 font-semibold">
        <td className="py-1" colSpan={8}>
          {judul}
        </td>
      </tr>
      {barisPohon(akar, { tampilkanNol: nol }).map((b) =>
        b.jenis === "judul" ? (
          <tr key={`j-${b.accountId}`}>
            <td className="py-1 font-medium" colSpan={8} style={{ paddingLeft: `${b.level * 14 + 6}px` }}>
              {b.code} {b.name}
            </td>
          </tr>
        ) : (
          <tr key={`${b.jenis}-${b.accountId}`} className="border-b border-gray-200">
            <td className={`py-1 ${b.jenis === "jumlah" ? "font-medium" : ""}`} style={{ paddingLeft: `${b.level * 14 + 6}px` }}>
              {b.jenis === "jumlah" ? `Jumlah ${b.name}` : `${b.code} ${b.name}`}
            </td>
            <Sel nilai={b.nilai} tebal={b.jenis === "jumlah"} />
          </tr>
        ),
      )}
      <tr className="font-semibold">
        <td className="py-1">{labelTotal}</td>
        <Sel nilai={total} tebal />
      </tr>
    </>
  );
}

export default function PrintPerbandinganPage() {
  const sp = useSearchParams();
  const nol = sp.get("nol") === "1";
  const [hasil, setHasil] = useState<Hasil | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    const jenis = sp.get("jenis") === "neraca" ? "neraca" : "laba-rugi";
    const muat =
      jenis === "neraca"
        ? getPerbandinganNeracaAction({ tanggal: sp.get("tanggal") ?? undefined }).then((r) => (r.ok ? ({ jenis, r } as Hasil) : "error" as const))
        : getPerbandinganLabaRugiAction({ dari: sp.get("dari") ?? undefined, sampai: sp.get("sampai") ?? undefined }).then((r) =>
            r.ok ? ({ jenis: "laba-rugi", r } as Hasil) : ("error" as const),
          );
    Promise.all([muat, bacaKesiapanCetakAction().catch(() => null)])
      .then(([h, k]) => {
        setKesiapan(k);
        setHasil(h);
      })
      .catch(() => setHasil("error"));
  }, [sp]);

  useCetakOtomatis(!!hasil && hasil !== "error");

  if (!hasil) return <MemuatCetak />;
  if (hasil === "error") return <GagalCetak />;

  const kolom =
    hasil.jenis === "laba-rugi" ? hasil.r.kolom.map(rentang) : hasil.r.kolom.map((d) => `Per ${tgl(d)}`);

  return (
    <div className="mx-auto max-w-[277mm]">
      <KepalaCetak
        judul={hasil.jenis === "laba-rugi" ? "Perbandingan Laba Rugi" : "Perbandingan Neraca"}
        periode={hasil.jenis === "laba-rugi" ? `Periode ${kolom[0]}` : kolom[0]}
        disiapkanOleh={hasil.r.disiapkanOleh}
        dicetak={hasil.r.dicetak}
      />
      <CatatanBukuBesar kesiapan={kesiapan} />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Keterangan</th>
            <th className="py-1 text-right">{kolom[0]}</th>
            <th className="py-1 text-right">{kolom[1]}</th>
            <th className="py-1 text-right">Selisih</th>
            <th className="py-1 text-right">%</th>
            <th className="py-1 text-right">{kolom[2]}</th>
            <th className="py-1 text-right">Selisih</th>
            <th className="py-1 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {hasil.jenis === "laba-rugi" ? (
            <>
              <Bagian judul="PENDAPATAN" akar={hasil.r.pendapatan} total={hasil.r.total.pendapatan} labelTotal="Total Pendapatan" nol={nol} />
              <Bagian judul="HARGA POKOK PENJUALAN" akar={hasil.r.hpp} total={hasil.r.total.hpp} labelTotal="Total Harga Pokok Penjualan" nol={nol} />
              <tr className="border-t-2 border-black font-bold">
                <td className="py-1">Laba Kotor</td>
                <Sel nilai={hasil.r.total.labaKotor} tebal />
              </tr>
              <Bagian judul="BEBAN OPERASIONAL" akar={hasil.r.beban} total={hasil.r.total.beban} labelTotal="Total Beban Operasional" nol={nol} />
              <tr className="border-t-2 border-black font-bold">
                <td className="py-1">Laba Bersih</td>
                <Sel nilai={hasil.r.total.labaBersih} tebal />
              </tr>
            </>
          ) : (
            <>
              <Bagian judul="ASET" akar={hasil.r.aset} total={hasil.r.total.aset} labelTotal="Total Aset" nol={nol} />
              <Bagian judul="LIABILITAS" akar={hasil.r.liabilitas} total={hasil.r.total.liabilitas} labelTotal="Total Liabilitas" nol={nol} />
              <Bagian judul="EKUITAS" akar={hasil.r.ekuitas} total={hasil.r.total.ekuitas} labelTotal="Total Ekuitas" nol={nol} />
              {hasil.r.total.labaTahunLalu.some((v) => v !== 0) ? (
                <tr>
                  <td className="py-1 pl-4">Laba (Rugi) Tahun Lalu Belum Ditutup</td>
                  <Sel nilai={hasil.r.total.labaTahunLalu} />
                </tr>
              ) : null}
              <tr>
                <td className="py-1 pl-4">Laba (Rugi) Tahun Berjalan</td>
                <Sel nilai={hasil.r.total.labaTahunBerjalan} />
              </tr>
              <tr className="border-t-2 border-black font-bold">
                <td className="py-1">Total Liabilitas dan Ekuitas</td>
                <Sel nilai={hasil.r.total.liabilitasEkuitas} tebal />
              </tr>
            </>
          )}
        </tbody>
      </table>
      <div className="mt-4 text-xs text-gray-700">
        <p className="font-semibold">Cakupan data</p>
        <p>{CAKUPAN_LAPORAN_BODY}</p>
      </div>
    </div>
  );
}

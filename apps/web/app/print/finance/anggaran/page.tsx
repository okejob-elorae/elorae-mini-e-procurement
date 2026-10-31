"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getLaporanAnggaranAction, type LaporanAnggaranAksi } from "@/app/actions/finance-laporan";
import { bacaKesiapanCetakAction, type KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { CatatanBukuBesar } from "../CatatanBukuBesar";
import { GagalCetak, KepalaCetak, MemuatCetak, useCetakOtomatis } from "../cetak-laporan";
import type { AccountType } from "@/lib/constants/enums";
import { capaianAnggaran } from "@/lib/finance/anggaran/aturan";
import { barisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import { persenLaporan, rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { CAKUPAN_LAPORAN_BODY } from "@/lib/finance/reports/disclosures";

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function Sel({ type, nilai, beranggaran, tebal }: { type: AccountType; nilai: number[]; beranggaran: boolean; tebal?: boolean }) {
  const c = capaianAnggaran(type, beranggaran ? nilai[0] : null, nilai[1]);
  const k = `py-1 text-right ${tebal ? "font-semibold" : ""}`;
  return (
    <>
      <td className={k}>{beranggaran ? rupiahLaporan(nilai[0]) : "—"}</td>
      <td className={k}>{rupiahLaporan(nilai[1])}</td>
      <td className={k}>{beranggaran ? rupiahLaporan(c.selisih) : "—"}</td>
      <td className={k}>{c.persenCapaian === null ? "—" : persenLaporan(c.persenCapaian)}</td>
    </>
  );
}

export default function PrintAnggaranPage() {
  const sp = useSearchParams();
  const nol = sp.get("nol") === "1";
  const [r, setR] = useState<LaporanAnggaranAksi | "error" | null>(null);
  const [kesiapan, setKesiapan] = useState<KesiapanCetak | null>(null);

  useEffect(() => {
    Promise.all([
      getLaporanAnggaranAction({ tahun: sp.get("tahun") ?? undefined, bulan: sp.get("bulan") ?? undefined, cakupan: sp.get("cakupan") ?? undefined }),
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

  const beranggaran = new Set(r.akunBeranggaran);
  const akhir = r.bulan[r.bulan.length - 1];
  const periode = r.cakupan === "bulan" ? `${NAMA_BULAN[akhir - 1]} ${r.tahun}` : `Januari – ${NAMA_BULAN[akhir - 1]} ${r.tahun}`;

  const bagian = (judul: string, type: AccountType, akar: SimpulNilai[], total: [number, number], labelTotal: string) => (
    <>
      <tr className="print-statement-band bg-gray-100 font-semibold">
        <td className="py-1" colSpan={5}>
          {judul}
        </td>
      </tr>
      {barisPohon(akar, { tampilkanNol: nol }).map((b) =>
        b.jenis === "judul" ? (
          <tr key={`j-${b.accountId}`}>
            <td className="py-1 font-medium" colSpan={5} style={{ paddingLeft: `${b.level * 14 + 6}px` }}>
              {b.code} {b.name}
            </td>
          </tr>
        ) : (
          <tr key={`${b.jenis}-${b.accountId}`} className="border-b border-gray-200">
            <td className={`py-1 ${b.jenis === "jumlah" ? "font-medium" : ""}`} style={{ paddingLeft: `${b.level * 14 + 6}px` }}>
              {b.jenis === "jumlah" ? `Jumlah ${b.name}` : `${b.code} ${b.name}`}
            </td>
            <Sel type={type} nilai={b.nilai} beranggaran={beranggaran.has(b.accountId)} tebal={b.jenis === "jumlah"} />
          </tr>
        ),
      )}
      <tr className="font-semibold">
        <td className="py-1">{labelTotal}</td>
        <Sel type={type} nilai={total} beranggaran={r.adaAnggaran} tebal />
      </tr>
    </>
  );

  return (
    <div className="print-statement mx-auto max-w-3xl">
      <KepalaCetak judul="Anggaran vs Realisasi" periode={periode} disiapkanOleh={r.disiapkanOleh} dicetak={r.dicetak} />
      <CatatanBukuBesar kesiapan={kesiapan} />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Akun</th>
            <th className="py-1 text-right">Anggaran</th>
            <th className="py-1 text-right">Realisasi</th>
            <th className="py-1 text-right">Selisih</th>
            <th className="py-1 text-right">Capaian</th>
          </tr>
        </thead>
        <tbody>
          {bagian("PENDAPATAN", "PENDAPATAN", r.pendapatan, r.total.pendapatan, "Total Pendapatan")}
          {bagian("HARGA POKOK PENJUALAN", "HPP", r.hpp, r.total.hpp, "Total Harga Pokok Penjualan")}
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Laba Kotor</td>
            <Sel type="PENDAPATAN" nilai={r.total.labaKotor} beranggaran={r.adaAnggaran} tebal />
          </tr>
          {bagian("BEBAN OPERASIONAL", "BEBAN", r.beban, r.total.beban, "Total Beban Operasional")}
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1">Laba Bersih</td>
            <Sel type="PENDAPATAN" nilai={r.total.labaBersih} beranggaran={r.adaAnggaran} tebal />
          </tr>
        </tbody>
      </table>
      <div className="mt-4 text-xs text-gray-700">
        <p className="font-semibold">Cakupan data</p>
        <p>{CAKUPAN_LAPORAN_BODY}</p>
      </div>
    </div>
  );
}

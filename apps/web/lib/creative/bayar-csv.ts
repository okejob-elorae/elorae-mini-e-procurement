/**
 * CSV "Daftar tagihan" Pembayaran KOL — murni, aman untuk klien.
 *
 * Tahap ini tanpa kolom rekening/NIK/NPWP/PPh (keputusan sementara pemilik
 * 2026-10-07 — data pajak menunggu tahap berikutnya). Diawali baris judul,
 * ditutup baris kosong + baris TOTAL, seperti tagihan KOL Manager.
 */

import { jumlahUang } from "./angka-konten";
import { LABEL_STATUS_BAYAR } from "./bayar-aturan";
import { susunCsv } from "./laporan-csv";
import { LABEL_TAHAP, type StatusBayar, type Tahap } from "./tahap";

export type BarisTagihanCsv = {
  /** Username tanpa "@" (sel berawalan "@" terbaca rumus di Excel). */
  username: string | null;
  namaKol: string;
  namaPenerima: string;
  campaign: string | null;
  tahap: Tahap;
  fee: number;
  dibayar: number;
  sisa: number;
  payStatus: StatusBayar;
  /** Hari WIB "YYYY-MM-DD". */
  paidAt: string | null;
  catatan: string | null;
};

export const KEPALA_TAGIHAN = [
  "No",
  "Username",
  "Nama KOL",
  "Nama penerima",
  "Campaign",
  "Tahap",
  "Fee",
  "Dibayar",
  "Sisa",
  "Status bayar",
  "Tanggal bayar",
  "Catatan",
] as const;

/** "tagihan-kol-2026-10-07.csv". */
export function namaBerkasTagihan(hariIni: string): string {
  return `tagihan-kol-${hariIni}.csv`;
}

export function csvTagihan(baris: readonly BarisTagihanCsv[], judul: string): string {
  const isi = baris.map((b, i) => [
    i + 1,
    b.username?.replace(/^@+/, "") ?? "",
    b.namaKol,
    b.namaPenerima,
    b.campaign ?? "",
    LABEL_TAHAP[b.tahap],
    b.fee,
    b.dibayar,
    b.sisa,
    LABEL_STATUS_BAYAR[b.payStatus],
    b.paidAt ?? "",
    b.catatan?.replace(/\s+/g, " ").trim() ?? "",
  ]);
  const total = [
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    jumlahUang(baris.map((b) => b.fee)),
    jumlahUang(baris.map((b) => b.dibayar)),
    jumlahUang(baris.map((b) => b.sisa)),
    "",
    "",
    "",
  ];
  return susunCsv([[judul], [...KEPALA_TAGIHAN], ...isi, [], total]);
}

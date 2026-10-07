/**
 * CSV termin pembayaran KOL dan bahan Coretax PPh dipotong — murni.
 *
 * Termin: tanpa nomor rekening/NIK/NPWP (hanya bank + empat digit terakhir).
 * PPh dipotong: identitas LENGKAP hanya bila pengunduhnya boleh membuka data
 * sensitif (keuangan + PIN, dicatat di jejak); selain itu tersamar.
 * Elorae tidak melapor ke Coretax — berkas ini bahan isian.
 */

import { susunCsv } from "./laporan-csv";
import { labelPasal } from "./pph";
import type { BarisPph, BarisTermin } from "./termin-queries";

const sen = (n: number) => Math.round(n * 100) / 100;

export const KEPALA_TERMIN = [
  "No",
  "No kolaborasi",
  "Username",
  "Nama KOL",
  "Campaign",
  "Termin",
  "Jenis PPh",
  "Gross-up",
  "Bruto",
  "DPP",
  "PPh",
  "Neto ke KOL",
  "Jatuh tempo",
  "Status",
  "Tanggal bayar",
  "No bukti potong",
  "Rekening",
  "Data pajak lengkap",
] as const;

export function namaBerkasTermin(hariIni: string): string {
  return `termin-kol-${hariIni}.csv`;
}

export function csvTermin(baris: readonly BarisTermin[], judul: string): string {
  let bruto = 0;
  let pph = 0;
  let neto = 0;
  const isi = baris.map((b, i) => {
    bruto += b.bruto;
    pph += b.pph;
    neto += b.neto;
    return [
      i + 1,
      b.docNo,
      b.handle,
      b.kolNama,
      b.campaignNama,
      `${b.label} (${b.urutan}/${b.jumlahTermin})`,
      b.warisan ? "Tidak dihitung (sebelum modul pajak)" : labelPasal(b.pasal),
      b.grossUp ? "Ya" : "Tidak",
      b.bruto,
      b.dpp,
      b.pph,
      b.neto,
      b.jatuhTempo?.tanggal ?? null,
      b.status === "DIBAYAR" ? "Dibayar" : "Belum dibayar",
      b.dibayarAt,
      b.nomorBuktiPotong,
      b.rekening.last4 ? `${b.rekening.bank ?? "Bank"} ••••${b.rekening.last4}` : null,
      b.jenisPajak === "TIDAK_DIPOTONG" || b.dataPajakLengkap ? "Ya" : "Belum",
    ];
  });
  return susunCsv([
    [judul],
    [...KEPALA_TERMIN],
    ...isi,
    [],
    ["TOTAL", null, null, null, null, null, null, null, sen(bruto), null, sen(pph), sen(neto)],
  ]);
}

export const KEPALA_PPH = [
  "Masa",
  "Tanggal bayar",
  "Jenis PPh",
  "Nama KOL",
  "Identitas (NIK/NPWP)",
  "Ber-NPWP",
  "Bruto",
  "DPP",
  "Tarif efektif (%)",
  "PPh",
  "Neto",
  "Gross-up",
  "No bukti potong",
  "Tanggal setor",
  "NTPN",
  "No kolaborasi",
  "Termin",
] as const;

export function namaBerkasPph(masa: string): string {
  return `pph-dipotong-kol-${masa}.csv`;
}

/**
 * `identitas`: peta kolId → identitas lengkap. Tanpa peta (pengunduh tidak
 * boleh membuka data sensitif) kolom identitas tersamar.
 */
export function csvPph(
  masa: string,
  baris: readonly BarisPph[],
  judul: string,
  identitas?: ReadonlyMap<string, { nik: string | null; npwp: string | null }>,
): string {
  let bruto = 0;
  let pph = 0;
  const isi = baris.map((b) => {
    bruto += b.bruto;
    pph += b.pph;
    const lengkap = identitas?.get(b.kolId);
    const id = lengkap ? (b.jenisPajak === "BADAN" ? (lengkap.npwp ?? lengkap.nik) : (lengkap.nik ?? lengkap.npwp)) : b.identitasTersamar;
    return [
      masa,
      b.dibayarAt,
      labelPasal(b.pasal),
      b.kolNama,
      // Diawali tanda kutip supaya Excel tidak membulatkan 16 digit menjadi notasi ilmiah.
      id ? (lengkap ? `'${id}` : id) : null,
      b.adaNpwp ? "Ya" : "Tidak",
      b.bruto,
      b.dpp,
      b.tarifEfektifPersen,
      b.pph,
      b.neto,
      b.grossUp ? "Ya" : "Tidak",
      b.nomorBuktiPotong,
      b.setorAt,
      b.ntpn,
      b.docNo,
      b.label,
    ];
  });
  return susunCsv([[judul], [...KEPALA_PPH], ...isi, [], ["TOTAL", null, null, null, null, null, sen(bruto), null, null, sen(pph)]]);
}

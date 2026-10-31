import { formatDateOnlyJakarta } from "@/lib/date-only";

/**
 * Keadaan satu faktur di panel Kredit toko — murni, supaya kolom "Keadaan" tidak lagi
 * mencampur dua tanggal. Janji bayar (tukar faktur) yang sudah lewat didahulukan, sama
 * dengan aturan piutang; selain itu faktur dinilai dari JATUH TEMPO-nya sendiri.
 * Hari dihitung per hari kalender WIB.
 */
export type KeadaanFakturKredit =
  | { jenis: "LEWAT_JANJI"; hari: number }
  | { jenis: "LEWAT_TEMPO"; hari: number }
  | { jenis: "BELUM_TEMPO" };

const HARI_MS = 24 * 60 * 60 * 1000;

/** Selisih hari kalender WIB dari `dari` ke `sampai` (positif bila `sampai` sesudahnya). */
export function selisihHariWib(dari: Date, sampai: Date): number {
  const a = Date.parse(`${formatDateOnlyJakarta(dari)}T00:00:00Z`);
  const b = Date.parse(`${formatDateOnlyJakarta(sampai)}T00:00:00Z`);
  return Math.round((b - a) / HARI_MS);
}

export function keadaanFakturKredit(f: {
  jatuhTempo: Date;
  janjiBayar: Date | null;
  /** Keadaan piutang `lewat` (janji lewat, tanpa klaim/retur tertahan yang mendahului). */
  lewatJanji: boolean;
  hariIni: Date;
}): KeadaanFakturKredit {
  if (f.lewatJanji && f.janjiBayar) return { jenis: "LEWAT_JANJI", hari: Math.max(0, selisihHariWib(f.janjiBayar, f.hariIni)) };
  const lewatTempo = selisihHariWib(f.jatuhTempo, f.hariIni);
  if (lewatTempo > 0) return { jenis: "LEWAT_TEMPO", hari: lewatTempo };
  return { jenis: "BELUM_TEMPO" };
}

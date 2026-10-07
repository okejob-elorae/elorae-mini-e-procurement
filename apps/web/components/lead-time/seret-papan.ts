import type { PickerTemplate } from "./process-picker";

/*
 * Seret-lepas di Papan Pemasok: dua jenis yang bisa dibawa —
 *  - `proses` dari palet kiri → dilepas ke kartu pemasok mana pun, di celah
 *    antara dua langkah (disisipkan di posisi itu);
 *  - `langkah` di dalam kartu → hanya ke kartunya sendiri (urutan ulang).
 */

export type DataSeretPapan =
  | { jenis: "proses"; template: PickerTemplate }
  | { jenis: "langkah"; supplierId: string; stepId: string; nama: string };

const AWALAN = "pemasok:";

/** `data-seret-daftar` satu kartu pemasok. */
export const daftarPemasok = (supplierId: string) => `${AWALAN}${supplierId}`;

/** Pemasok dari `data-seret-daftar`; null bila bukan kartu pemasok. */
export const pemasokDariDaftar = (daftar: string): string | null =>
  daftar.startsWith(AWALAN) ? daftar.slice(AWALAN.length) || null : null;

export function bolehLepasPapan(data: DataSeretPapan, daftar: string): boolean {
  const pemasok = pemasokDariDaftar(daftar);
  if (!pemasok) return false;
  return data.jenis === "proses" || pemasok === data.supplierId;
}

/** Butir ini yang sedang dibawa? */
export function sedangDibawa(
  data: DataSeretPapan | null | undefined,
  butir: { jenis: "proses"; templateId: string } | { jenis: "langkah"; stepId: string },
): boolean {
  if (!data || data.jenis !== butir.jenis) return false;
  return data.jenis === "proses"
    ? butir.jenis === "proses" && data.template.id === butir.templateId
    : butir.jenis === "langkah" && data.stepId === butir.stepId;
}

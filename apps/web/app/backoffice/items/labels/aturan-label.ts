import type { OpsiCetakLabel } from "@/lib/print/label-barcode-html";

/**
 * Keputusan pemilik (2026-10-06, keputusan 20): label barang TIDAK mencetak
 * harga, gaya apa pun — RINCI kini sama dengan ELORAE ("harga tidak di cetak di
 * label"). Satu tempat: ubah konstanta ini bila keputusannya berubah.
 */
export const LABEL_MENCETAK_HARGA = false;

/** Opsi cetak yang dikirim ke pembuat label: pilihan tersimpan lama tidak bisa menyalakan harga. */
export function opsiCetakLabel(opsi: OpsiCetakLabel): OpsiCetakLabel {
  return { ...opsi, tampilHarga: LABEL_MENCETAK_HARGA && opsi.tampilHarga };
}

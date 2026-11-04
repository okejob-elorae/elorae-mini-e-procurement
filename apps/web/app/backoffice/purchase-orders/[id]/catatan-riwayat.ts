/*
 * Catatan riwayat status PO untuk DITAMPILKAN.
 *
 * Penulis lama menyimpan teks tetap berbahasa Inggris ("GRN issued: …",
 * "Supplier payment marked", "PO Created"). Teks itu diperlakukan sebagai KODE
 * tindakan dan diterjemahkan lewat `purchaseOrders.riwayat.<kunci>`, jadi
 * riwayat lama dan baru tampil dalam bahasa pengguna tanpa migrasi data.
 * Alasan yang diketik orang (batal, ubah status) tampil apa adanya.
 */

export type CatatanRiwayatPo =
  | { kunci: KunciCatatanRiwayat; nilai: Record<string, string> }
  | { teks: string };

export type KunciCatatanRiwayat =
  | "grnDiterima"
  | "grnDisetujuiPemilik"
  | "grnDitolakPemilik"
  | "dibuat"
  | "diubahPin"
  | "bayarDitandai"
  | "bayarDibatalkan"
  | "grnSebagian"
  | "grnLengkap"
  | "dibatalkan"
  | "statusBerubah"
  | "ditutup"
  | "returDiproses";

/** Teks tetap → kunci. Satu tempat: penulis baru cukup menambah barisnya di sini. */
const TEKS_TETAP: Record<string, KunciCatatanRiwayat> = {
  "PO Created": "dibuat",
  "PO Edited (PIN verified)": "diubahPin",
  "Supplier payment marked": "bayarDitandai",
  "Supplier payment unmarked": "bayarDibatalkan",
  "Partial GRN received": "grnSebagian",
  // Ditulis data seed (packages/db/prisma/seed.ts) untuk PO yang tuntas diterima.
  "Fully received": "grnLengkap",
  "PO Cancelled": "dibatalkan",
};

/** Awalan + nama nilai sisanya. */
const BERAWALAN: Array<[awalan: string, kunci: KunciCatatanRiwayat, namaNilai: string]> = [
  ["GRN issued: ", "grnDiterima", "nomor"],
  ["GRN owner-approved: ", "grnDisetujuiPemilik", "nomor"],
  ["GRN owner-declined: ", "grnDitolakPemilik", "nomor"],
  ["Status changed to ", "statusBerubah", "status"],
  ["Ditutup sebelum lengkap: ", "ditutup", "alasan"],
];

/** Pola dengan lebih dari satu nilai (`processReturn` di app/actions/vendor-returns.ts). */
const POLA: Array<[pola: RegExp, kunci: KunciCatatanRiwayat, namaNilai: string[]]> = [
  [/^Vendor return (.+) processed \(WO (.+)\)$/, "returDiproses", ["retur", "wo"]],
];

export function catatanRiwayatPo(notes: string | null | undefined): CatatanRiwayatPo | null {
  const teks = (notes ?? "").trim();
  if (!teks) return null;
  const tetap = TEKS_TETAP[teks];
  if (tetap) return { kunci: tetap, nilai: {} };
  for (const [pola, kunci, namaNilai] of POLA) {
    const cocok = pola.exec(teks);
    if (cocok) return { kunci, nilai: Object.fromEntries(namaNilai.map((n, i) => [n, cocok[i + 1].trim()])) };
  }
  for (const [awalan, kunci, namaNilai] of BERAWALAN) {
    if (teks.startsWith(awalan)) {
      const sisa = teks.slice(awalan.length).trim();
      if (sisa) return { kunci, nilai: { [namaNilai]: sisa } };
    }
  }
  return { teks };
}

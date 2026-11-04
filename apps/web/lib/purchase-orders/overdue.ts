import { batasHariIniWib } from "@/lib/dashboard/hari-wib";

/**
 * Status PO yang bisa terlambat: pemasok sudah menerima PO-nya dan barangnya
 * belum lengkap.
 *
 * Alur PO di aplikasi ini: DRAFT → "Ajukan" (`submitPO`, butuh izin
 * menyetujui, catatannya "PO Submitted to supplier") → SUBMITTED → penerimaan
 * barang → PARTIAL / CLOSED / OVER. Tidak ada status "disetujui" atau "dikirim"
 * tersendiri: SUBMITTED ADALAH PO yang sudah di tangan pemasok, dan satu-satunya
 * keadaan di mana pemasok belum mengirim apa pun. Mengecualikannya akan membuat
 * pemasok yang sama sekali belum mengirim tidak pernah terhitung terlambat.
 *
 * DRAFT tidak pernah: belum ada yang berjanji apa pun.
 */
export const STATUS_PO_BISA_TERLAMBAT = ["SUBMITTED", "PARTIAL"] as const;

/**
 * Filter Prisma "PO terlambat" — SATU definisi untuk beranda, lencana menu,
 * dan saringan `?status=overdue` di daftar PO, supaya ketiganya menyebut angka
 * yang sama.
 *
 * Tanggal tiba HARI INI belum terlambat: pembandingnya awal hari ini WIB, bukan
 * jam sekarang. Tanggal tiba disimpan sebagai tengah malam WIB, jadi
 * `etaDate < sekarang` menandai PO yang jatuh tempo hari ini sebagai terlambat
 * sejak 00.01.
 */
export function overduePOWhere(sekarang: Date = new Date()) {
  return {
    etaDate: { lt: batasHariIniWib(sekarang).awal },
    status: { in: [...STATUS_PO_BISA_TERLAMBAT] },
  };
}

/**
 * Saringan status di URL daftar PO. `overdue` bukan status PO melainkan
 * saringan "PO terlambat" di atas — tautan beranda dan lencana menu samping
 * memakai `?status=overdue`, dan sebelum ini halaman mengabaikannya: tautan
 * "3 PO terlambat" membuka daftar semua PO.
 */
export type POStatusFilter = "DRAFT" | "SUBMITTED" | "PARTIAL" | "CLOSED" | "OVER" | "CANCELLED" | "overdue" | "";

const NILAI_STATUS_PO: readonly string[] = ["DRAFT", "SUBMITTED", "PARTIAL", "CLOSED", "OVER", "CANCELLED"];

export function parsePOStatusFilter(raw: string | null | undefined): POStatusFilter {
  if (raw === "overdue") return "overdue";
  return raw && NILAI_STATUS_PO.includes(raw) ? (raw as POStatusFilter) : "";
}

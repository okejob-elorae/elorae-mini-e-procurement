// Pengklasifikasi murni nasib satu nota SPG dari antrean HP. Impor TIPE saja
// (terhapus saat kompilasi), jadi modul ini — dan tesnya — tidak pernah memuat
// aksi server, next-auth, atau Prisma. Pola yang sama dengan `classify.ts`.
import type { KodeGagalJualSpgAksi, RecordSpgSaleActionResult } from "@/app/actions/spg-sale";

/**
 * - `evict`    : tercatat (atau sudah tercatat sebelumnya — kunci yang sama
 *                mengembalikan nota yang ada); hapus dari HP.
 * - `terminal` : server menolak ISI nota. Mengirim ulang hanya ditolak lagi, jadi
 *                berhenti dan tunjukkan alasannya ke SPG.
 * - `retry`    : belum tentu sampai (sinyal putus, server sibuk). Coba lagi nanti.
 */
export type NasibNotaSpg = "evict" | "terminal" | "retry";

/**
 * Tidak ada kode galat aksi yang "sementara": galat tak terduga di server
 * MELEMPAR (→ coba lagi), sedangkan setiap kode yang dikembalikan menolak isi
 * notanya — harga hilang, diskon melewati batas, kunjungan bukan milik SPG ini,
 * nota lebih tua dari 14 hari. Kode baru yang belum dikenal juga dihentikan:
 * nota yang diam-diam diulang selamanya terbaca sebagai "belum ada sinyal",
 * padahal SPG perlu tahu dan menghubungi kantor.
 */
export function nasibNotaSpg(hasil: RecordSpgSaleActionResult | { thrown: true }): NasibNotaSpg {
  if ("thrown" in hasil) return "retry";
  if (hasil.ok) return "evict";
  return "terminal";
}

/**
 * Kode yang punya teks alasan sendiri di layar "Belum terkirim". Lainnya memakai
 * teks umum. `KUNJUNGAN_DITOLAK` bukan kode server: HP berhenti sendiri karena
 * check-in tanpa sinyal yang mengikat nota ini ditolak server.
 */
export const KODE_ALASAN_NOTA_SPG: readonly (KodeGagalJualSpgAksi | "KUNJUNGAN_DITOLAK")[] = [
  "KUNJUNGAN_DITOLAK",
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "NO_ACTIVE_VISIT",
  "KUNJUNGAN_TIDAK_SAH",
  "VALIDATION",
  "EMPTY",
  "STORE_NOT_FOUND",
  "NO_PRICE",
  "INSUFFICIENT_PAYMENT",
  "DISKON_MANUAL_NONAKTIF",
  "DISKON_MANUAL_LEWAT_BATAS",
  "DISKON_MANUAL_TIDAK_VALID",
  "ALASAN_DISKON_WAJIB",
  "PELANGGAN_TIDAK_VALID",
  "WAKTU_TIDAK_VALID",
];

/** Kunci teks alasan untuk kode di kolom `error` antrean; `UMUM` kalau kodenya tidak dikenal. */
export function kunciAlasanNotaSpg(kode: string | undefined): string {
  return kode && (KODE_ALASAN_NOTA_SPG as readonly string[]).includes(kode) ? kode : "UMUM";
}

/**
 * Bagian nota yang bisa dibuang supaya penjualannya tetap tercatat.
 *
 * Penolakan karena diskon SPG (kantor mematikannya atau menurunkan batasnya
 * selagi nota menunggu sinyal) atau karena data pembeli tidak menghapus fakta
 * bahwa barangnya terjual. SPG ditawari mengirim ulang TANPA bagian itu —
 * pilihan sadar di layar, tidak pernah otomatis.
 */
export type BagianDibuang = "diskon" | "pembeli";

export function bagianBisaDibuang(kode: string | undefined): BagianDibuang | null {
  switch (kode) {
    case "DISKON_MANUAL_NONAKTIF":
    case "DISKON_MANUAL_LEWAT_BATAS":
    case "DISKON_MANUAL_TIDAK_VALID":
    case "ALASAN_DISKON_WAJIB":
      return "diskon";
    case "PELANGGAN_TIDAK_VALID":
      return "pembeli";
    default:
      return null;
  }
}

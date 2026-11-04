// Pure sync-result classifier. Type-only import of SubmitResult (erased at compile) so this
// module — and its unit test — never pull the server action / next-auth / next/server chain.
import type { SubmitResult } from "@/app/pwa/stores/[id]/catalog/actions";

export type SyncDecision = "evict" | "terminal" | "retry";

/*
 * Penolakan server atas ISI pesanan: mengirim ulang hanya akan ditolak lagi.
 * KREDIT_DIBLOKIR ikut di sini — tagihan toko tidak berubah hanya karena HP
 * mencoba lagi, dan pesanan yang tertahan di antrean tanpa alasan akan terbaca
 * sebagai "belum ada sinyal". Salesman perlu melihat alasannya dan menghubungi kantor.
 */
const TERMINAL = new Set([
  "MIN_QTY",
  "NO_ACTIVE_VISIT",
  "EMPTY",
  "UNAUTHORIZED",
  // Barangnya sudah tidak dijual (nonaktif / bukan barang jadi) — mengulang tidak membantu.
  "ITEM_UNAVAILABLE",
  "KREDIT_DIBLOKIR",
  "JARAK_JAUH_NONAKTIF",
  "BUKAN_TOKO_SENDIRI",
  // Jendela pre-order sudah tutup/dirilis saat antrean akhirnya tersinkron — mengulang tidak akan pernah berhasil.
  "INDEN_DITOLAK",
  // Pesanan yang hendak diganti sudah diputuskan kantor (atau sudah dibatalkan/diganti) — mengulang tidak akan pernah berhasil.
  "PESANAN_LAMA_TIDAK_BISA_DIGANTI",
  // Check-in tanpa sinyal yang mengikat pesanan ini tidak tercatat (ditolak server, atau dihapus dari HP).
  "KUNJUNGAN_TIDAK_SAH",
  // PUTUS: barangnya belum punya harga — kantor harus menetapkannya dulu, mengulang tidak membantu.
  "BARANG_TANPA_HARGA",
]);

export function classifyResult(r: SubmitResult | { thrown: true }): SyncDecision {
  if ("thrown" in r) return "retry";
  if (r.ok) return "evict";
  return TERMINAL.has(r.code) ? "terminal" : "retry";
}

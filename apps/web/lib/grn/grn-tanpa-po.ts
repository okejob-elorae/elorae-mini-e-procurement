import type { Prisma } from "@elorae/db";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/*
 * Penerimaan barang (GRN) TANPA PO (keputusan pemilik 2026-11-02, P51 "harus ada PO, baru bisa di
 * proses" + P51a "tidak usah di hapus, tapi ada konfirmasi dari admin saja"): GRN tanpa PO tetap
 * boleh dicatat, tetapi tersimpan MENUNGGU — tidak menggerakkan stok, tidak menulis kartu stok,
 * tidak membuat roll kain, tidak menjurnal hutang, dan tidak bisa ditagih, diminta invoice-nya, atau
 * diretur — sampai pemegang `goods_receipts:confirm_no_po` (bawaannya hanya admin) mengonfirmasinya.
 * Konfirmasi menjalankan pemrosesan yang PERSIS sama dengan GRN ber-PO hari ini (`prosesBarisGrn`).
 *
 * Menolak GRN tanpa PO BELUM dibangun: pemilik belum menjawab apakah penerimaan seperti itu boleh
 * ditolak (barang fisiknya sudah datang). Sampai dijawab, GRN yang menunggu tetap tampil di Beranda,
 * saringan `?konfirmasi=menunggu`, dan lencana daftar GRN.
 *
 * GRN yang tersimpan sebelum aturan ini, dan GRN tanpa PO yang dicatat image lama di jendela
 * penerapan, ber-`requiresNoPoConfirmation = false` (bawaan kolom) dan tetap diproses seperti adanya.
 *
 * Murni (hanya rbac dan tipe Prisma), aman untuk komponen klien.
 */

/**
 * Prisma `where` untuk GRN yang SUDAH diproses: bukan GRN tanpa PO yang masih menunggu konfirmasi,
 * dan tidak ditolak pemilik (terima-lebih). Untuk daftar yang hanya memuat penerimaan yang benar-benar
 * masuk stok dan menjadi utang (tagihan vendor, belum ditagih, saldo awal hutang).
 */
export const SYARAT_GRN_DIPROSES: Prisma.GRNWhereInput = {
  ownerDeclinedAt: null,
  OR: [{ requiresNoPoConfirmation: false }, { noPoConfirmedAt: { not: null } }],
};

/**
 * Hanya bagian konfirmasi tanpa PO dari `SYARAT_GRN_DIPROSES`, untuk pembaca yang SENGAJA tetap memuat
 * GRN yang ditolak pemilik — buku pembantu hutang: GRN ditolak yang jurnal pembaliknya belum terposting
 * masih berhutang di buku besar, jadi tidak boleh hilang dari buku pembantunya.
 */
export const SYARAT_KONFIRMASI_TANPA_PO: Prisma.GRNWhereInput = {
  OR: [{ requiresNoPoConfirmation: false }, { noPoConfirmedAt: { not: null } }],
};

/** Prisma `where` untuk GRN tanpa PO yang masih menunggu konfirmasi admin. */
export const SYARAT_GRN_MENUNGGU_KONFIRMASI: Prisma.GRNWhereInput = { requiresNoPoConfirmation: true, noPoConfirmedAt: null };

export type KeadaanKonfirmasiTanpaPo = "menunggu" | "dikonfirmasi" | null;

/** Keadaan konfirmasi satu GRN; null = GRN ber-PO, atau GRN lama yang tidak pernah menunggu. */
export function keadaanKonfirmasiTanpaPo(g: { requiresNoPoConfirmation: boolean; noPoConfirmedAt: Date | string | null }): KeadaanKonfirmasiTanpaPo {
  if (!g.requiresNoPoConfirmation) return null;
  return g.noPoConfirmedAt == null ? "menunggu" : "dikonfirmasi";
}

/** GRN yang belum boleh menggerakkan stok atau menjadi utang. */
export function grnBelumDiproses(g: { requiresNoPoConfirmation: boolean; noPoConfirmedAt: Date | string | null }): boolean {
  return keadaanKonfirmasiTanpaPo(g) === "menunggu";
}

/** Tombol Konfirmasi memeriksa izin yang SAMA dengan aksinya (`putuskanGrnTanpaPoAction`). */
export function bolehMengonfirmasiGrnTanpaPo(izin?: string[]): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.GOODS_RECEIPTS_CONFIRM_NO_PO);
}

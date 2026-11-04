import type { PendingReturn } from "@/lib/pwa/offline/db";

/**
 * Nota retur di antrean HP yang ditolak karena barangnya cocok dengan barang selisih nota lain
 * yang sedang dikirim balik (`ADA_SELISIH_DITEMUKAN`). "Coba lagi" mengirimnya apa adanya dan
 * ditolak lagi; yang menyelesaikannya adalah pernyataan pelapor bahwa ini retur LAIN
 * (`ulangReturSebagaiReturLain`), sama dengan centang di formulir daring.
 */
export function bisaDikirimSebagaiReturLain(r: Pick<PendingReturn, "syncState" | "error">): boolean {
  return r.syncState === "failed" && r.error === "ADA_SELISIH_DITEMUKAN";
}

/**
 * Isi `{noNrt}` teks retur di antrean — alasan penolakan `ADA_SELISIH_DITEMUKAN` dan konfirmasi
 * "ini retur lain": nomor nota yang barang selisihnya cocok (`noNrtSelisih`, disimpan saat sinkron).
 * Teks yang memakai tempat kosong itu tanpa nilainya gagal diformat dan menampilkan kuncinya.
 */
export function nilaiTeksReturTertahan(r: Pick<PendingReturn, "noNrtSelisih">): { noNrt: string } {
  return { noNrt: r.noNrtSelisih || "—" };
}

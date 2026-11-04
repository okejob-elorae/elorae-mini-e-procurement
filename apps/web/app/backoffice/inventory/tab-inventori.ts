/** Tab halaman Inventori yang boleh datang dari `?tab=`. */
export const TAB_INVENTORI = ["stock", "grn", "rolls", "adjustments"] as const;
export type TabInventori = (typeof TAB_INVENTORI)[number];

export function tabInventori(nilai: string | null | undefined): TabInventori {
  return (TAB_INVENTORI as readonly string[]).includes(nilai ?? "") ? (nilai as TabInventori) : "stock";
}

/**
 * Saringan tab Penerimaan dari `?konfirmasi=` (tautan Beranda `grnNoPoPending` dan lonceng
 * `GRN_NO_PO_PENDING`): "menunggu" = hanya GRN tanpa PO yang menunggu konfirmasi admin — syarat yang
 * sama dengan hitungan Beranda (`SYARAT_GRN_MENUNGGU_KONFIRMASI`, `hitungGrnTanpaPoMenunggu`).
 * Nilai lain diabaikan (daftar lengkap).
 */
export function konfirmasiGrnDariUrl(nilai: string | null | undefined): "menunggu" | null {
  return nilai === "menunggu" ? "menunggu" : null;
}

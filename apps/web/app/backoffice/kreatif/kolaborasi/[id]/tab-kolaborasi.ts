/** Tab rincian kolaborasi — murni (dipakai halaman server dan komponen klien). */

export const TAB_KOLABORASI = ["pengiriman", "konten", "penjualan", "pembayaran", "catatan", "brief"] as const;
export type TabKolaborasiKunci = (typeof TAB_KOLABORASI)[number];

export function bacaTabKolaborasi(v: unknown): TabKolaborasiKunci {
  return typeof v === "string" && (TAB_KOLABORASI as readonly string[]).includes(v) ? (v as TabKolaborasiKunci) : "pengiriman";
}

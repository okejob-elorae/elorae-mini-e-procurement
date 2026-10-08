/**
 * Tab tabel Kinerja SPG di alamat (`?tampilan=kehadiran`), seperti tab halaman
 * lain di grup SPG. Bawaan "penjualan" tidak ditulis supaya alamatnya pendek.
 * Murni — dipakai halaman (baca) dan klien (tulis).
 */
export type Tampilan = "penjualan" | "kehadiran";

export function bacaTampilan(x: unknown): Tampilan {
  const v = Array.isArray(x) ? x[0] : x;
  return v === "kehadiran" ? "kehadiran" : "penjualan";
}

/** Query string baru (tanpa "?") sesudah tab diganti; parameter lain dipertahankan. */
export function cariDenganTampilan(cari: string, v: Tampilan): string {
  const q = new URLSearchParams(cari);
  if (v === "penjualan") q.delete("tampilan");
  else q.set("tampilan", v);
  return q.toString();
}

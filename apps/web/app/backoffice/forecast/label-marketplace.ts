// Nama marketplace & periode impor yang rapi (aman untuk klien).
const NAMA_MARKETPLACE: Record<string, string> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  TOKOPEDIA: "Tokopedia",
  LAZADA: "Lazada",
};

/** "SHOPEE" → "Shopee"; kode tak dikenal ditulis huruf awal kapital. */
export function namaMarketplace(kode: string): string {
  return NAMA_MARKETPLACE[kode] ?? (kode ? kode.charAt(0) + kode.slice(1).toLowerCase() : kode);
}

/** "Oktober 2026" (bulan 1–12). */
export function labelBulanTahun(bulan: number, tahun: number, locale = "id-ID"): string {
  const nama = new Date(Date.UTC(tahun, bulan - 1, 1)).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  return `${nama} ${tahun}`;
}

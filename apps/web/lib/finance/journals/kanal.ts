/**
 * Dimensi KANAL pada baris jurnal (`JournalLine.channel`) — murni, aman untuk
 * komponen klien.
 *
 * Baris pendapatan, HPP, dan beban penjualan membawa kanal (dan `storeId` bila
 * ada) supaya laba per kanal dan per toko terbaca langsung dari buku besar.
 * Nilai yang disimpan SELALU salah satu `KANAL_JURNAL`; jangan menulis string
 * bebas — laporan mengelompokkan menurut nilai persis ini.
 */

export const KANAL_JURNAL = {
  SHOPEE: "SHOPEE",
  TIKTOK: "TIKTOK",
  TOKOPEDIA: "TOKOPEDIA",
  MARKETPLACE_LAIN: "MARKETPLACE_LAIN",
  PUTUS: "PUTUS",
  KONSINYASI: "KONSINYASI",
  KANVAS: "KANVAS",
  KOL: "KOL",
  LAINNYA: "LAINNYA",
} as const;

export type KanalJurnal = (typeof KANAL_JURNAL)[keyof typeof KANAL_JURNAL];

/** Urutan tampil di laporan. */
export const SEMUA_KANAL_JURNAL: readonly KanalJurnal[] = [
  KANAL_JURNAL.SHOPEE,
  KANAL_JURNAL.TIKTOK,
  KANAL_JURNAL.TOKOPEDIA,
  KANAL_JURNAL.MARKETPLACE_LAIN,
  KANAL_JURNAL.PUTUS,
  KANAL_JURNAL.KONSINYASI,
  KANAL_JURNAL.KANVAS,
  KANAL_JURNAL.KOL,
  KANAL_JURNAL.LAINNYA,
];

/** Kanal yang dijual lewat marketplace (pesanan Jubelio). */
export const KANAL_MARKETPLACE: readonly KanalJurnal[] = [
  KANAL_JURNAL.SHOPEE,
  KANAL_JURNAL.TIKTOK,
  KANAL_JURNAL.TOKOPEDIA,
  KANAL_JURNAL.MARKETPLACE_LAIN,
];

export const LABEL_KANAL_JURNAL: Readonly<Record<KanalJurnal, string>> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  TOKOPEDIA: "Tokopedia",
  MARKETPLACE_LAIN: "Marketplace lain",
  PUTUS: "Toko putus",
  KONSINYASI: "Konsinyasi",
  KANVAS: "Kanvas",
  KOL: "KOL",
  LAINNYA: "Lainnya",
};

/** Label untuk baris yang tidak membawa kanal (jurnal lama, jurnal neraca). */
export const LABEL_TANPA_KANAL = "Tanpa kanal";

const NILAI = new Set<string>(SEMUA_KANAL_JURNAL);

/** Nilai tersimpan → kanal yang dikenal, atau null bila kosong/tidak dikenal. */
export function bacaKanalJurnal(nilai: unknown): KanalJurnal | null {
  return typeof nilai === "string" && NILAI.has(nilai) ? (nilai as KanalJurnal) : null;
}

export function labelKanalJurnal(nilai: string | null | undefined): string {
  const kanal = bacaKanalJurnal(nilai);
  return kanal ? LABEL_KANAL_JURNAL[kanal] : LABEL_TANPA_KANAL;
}

/**
 * Kanal jurnal untuk pesanan marketplace, dari `SalesOrder.channel`
 * (enum `SalesChannel`: SHOPEE, TIKTOK, TOKOPEDIA, OTHER, OFFLINE) atau dari
 * `Settlement.marketplace`. OTHER/OFFLINE dan nilai yang tidak dikenal masuk
 * `MARKETPLACE_LAIN` — sama dengan "Jubelio lain" di grafik beranda. Huruf
 * besar/kecil diabaikan.
 */
export function kanalMarketplace(channel: string | null | undefined): KanalJurnal {
  switch ((channel ?? "").trim().toUpperCase()) {
    case "SHOPEE":
      return KANAL_JURNAL.SHOPEE;
    case "TIKTOK":
    case "TIKTOK_SHOP":
    case "TIKTOKSHOP":
      return KANAL_JURNAL.TIKTOK;
    case "TOKOPEDIA":
      return KANAL_JURNAL.TOKOPEDIA;
    default:
      return KANAL_JURNAL.MARKETPLACE_LAIN;
  }
}

/** Kanal jurnal untuk pesanan lapangan (`FieldSalesOrder.orderType`). */
export function kanalPesananLapangan(orderType: "PUTUS" | "KONSI" | string): KanalJurnal {
  return orderType === "KONSI" ? KANAL_JURNAL.KONSINYASI : KANAL_JURNAL.PUTUS;
}

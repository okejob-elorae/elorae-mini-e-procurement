/*
 * Aturan tampilan halaman HPP — murni, aman untuk klien.
 */

export const STATUS_SPK = ["DRAFT", "ISSUED", "IN_PRODUCTION", "PARTIAL", "COMPLETED", "CANCELLED"] as const;
export type StatusSpk = (typeof STATUS_SPK)[number];

/** AKTIF = semua kecuali dibatalkan (bawaan); SEMUA = termasuk dibatalkan. */
export type SaringanStatusHpp = "AKTIF" | "SEMUA" | StatusSpk;

export type SaringanHpp = {
  /** Id barang jadi; "" = semua. */
  barang: string;
  /** Id pemasok (CMT); "" = semua. */
  vendor: string;
  /** Tanggal WO dibuat, YYYY-MM-DD; "" = tanpa batas. */
  dari: string;
  sampai: string;
  status: SaringanStatusHpp;
};

export const SARINGAN_HPP_BAWAAN: SaringanHpp = { barang: "", vendor: "", dari: "", sampai: "", status: "AKTIF" };

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function satu(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** `?barang=&vendor=&dari=&sampai=&status=` → saringan; nilai asing diabaikan. */
export function bacaSaringanHpp(sp: Record<string, string | string[] | undefined>): SaringanHpp {
  const status = satu(sp.status);
  const dari = satu(sp.dari);
  const sampai = satu(sp.sampai);
  return {
    barang: satu(sp.barang),
    vendor: satu(sp.vendor),
    dari: TANGGAL.test(dari) ? dari : "",
    sampai: TANGGAL.test(sampai) ? sampai : "",
    status: status === "SEMUA" || (STATUS_SPK as readonly string[]).includes(status) ? (status as SaringanStatusHpp) : "AKTIF",
  };
}

/** Saringan → query string ("" bila semuanya bawaan). Nilai bawaan tidak ditulis. */
export function alamatSaringanHpp(s: SaringanHpp): string {
  const q = new URLSearchParams();
  if (s.barang) q.set("barang", s.barang);
  if (s.vendor) q.set("vendor", s.vendor);
  if (s.dari) q.set("dari", s.dari);
  if (s.sampai) q.set("sampai", s.sampai);
  if (s.status !== "AKTIF") q.set("status", s.status);
  const teks = q.toString();
  return teks ? `?${teks}` : "";
}

export function lolosStatus(status: string, saringan: SaringanStatusHpp): boolean {
  if (saringan === "SEMUA") return true;
  if (saringan === "AKTIF") return status !== "CANCELLED";
  return status === saringan;
}

const QTY = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

/** Qty gaya Indonesia: bulat tanpa ",00", pecahan (mis. meter kain per pcs) sampai tiga angka. */
export function formatQty(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : QTY.format(n);
}

/**
 * SATU definisi HPP/pcs untuk tabel dan dialog (keputusan sementara, 2026-10-06):
 * angka utama = jumlah biaya per pcs SEBAGAIMANA TERCATAT (`subtotal`) — dasar
 * harga jual (`calculateHPP`: harga jual = HPP × (1 + markup) + biaya tambahan).
 * Biaya tercatat itu campuran: bahan biasanya sudah termasuk PPN, jasa biasanya
 * belum (`ppnIncluded` per baris), jadi angka ini BUKAN "sebelum PPN". Angka
 * kedua (`nettSubtotal`) menaikkan biaya yang belum ber-PPN sebesar tarif PPN —
 * "bila semua biaya termasuk PPN" — dan selalu disebut dengan labelnya. Dulu
 * tabel menulis 96.000 dan dialog 98.838 untuk WO yang sama, keduanya berlabel
 * "HPP/pcs".
 */
export function hppSatuan(row: { subtotal: number; nettSubtotal?: number }): { tercatat: number; termasukPpn: number } {
  return { tercatat: row.subtotal, termasukPpn: row.nettSubtotal ?? row.subtotal };
}

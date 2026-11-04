/**
 * Saringan daftar Pesanan lapangan yang dibawa dari Kinerja sales lapangan:
 * `?dari=` / `?sampai=` (hari WIB, tanggal pesanan DIBUAT, kedua ujung
 * termasuk) dan `?salesman=` (pembuat pesanan). Bersama `?status=AKTIF`
 * (menunggu + disetujui) daftarnya berisi persis pesanan yang dihitung kartu
 * "Nilai pesanan putus" — aturan hari yang sama dengan `metrik-lapangan.ts`.
 *
 * Murni: halaman membaca alamat, kueri menerima batas instan.
 */
import { awalHari, batasRentang, sahKunciHari, type Rentang } from "@/lib/salesman/metrik-lapangan";

export const ALAMAT_PESANAN_LAPANGAN = "/backoffice/field-sales-orders";

export type SaringanKinerja = {
  /** Hari pertama (`YYYY-MM-DD`) atau null bila tidak disaring. */
  dari: string | null;
  sampai: string | null;
  salesmanId: string | null;
  /** `createdAt >= dibuatSejak`. */
  dibuatSejak: Date | null;
  /** `createdAt < dibuatSebelum` (awal hari sesudah `sampai`). */
  dibuatSebelum: Date | null;
};

const satu = (x: unknown): string | undefined => (Array.isArray(x) ? x[0] : typeof x === "string" ? x : undefined);

/** Nilai alamat yang tidak sah diabaikan; rentang terbalik ditukar. */
export function bacaSaringanKinerja(sp: { dari?: unknown; sampai?: unknown; salesman?: unknown }): SaringanKinerja {
  let dari = sahKunciHari(satu(sp.dari)) ? (satu(sp.dari) as string) : null;
  let sampai = sahKunciHari(satu(sp.sampai)) ? (satu(sp.sampai) as string) : null;
  if (dari && sampai && dari > sampai) [dari, sampai] = [sampai, dari];
  const s = satu(sp.salesman)?.trim();
  return {
    dari,
    sampai,
    salesmanId: s && s.length <= 64 ? s : null,
    dibuatSejak: dari ? awalHari(dari) : null,
    dibuatSebelum: sampai ? batasRentang({ dari: sampai, sampai }).akhir : null,
  };
}

/** Ada saringan kinerja yang aktif (untuk keping "Hapus saringan ini"). */
export function adaSaringanKinerja(s: SaringanKinerja): boolean {
  return !!(s.dari || s.sampai || s.salesmanId);
}

/**
 * Alamat daftar pesanan yang isinya sama dengan angka kartu/baris Kinerja sales
 * lapangan: pesanan menunggu + disetujui yang DIBUAT dalam rentang, opsional
 * satu sales.
 */
export function alamatPesananKinerja(rentang: Rentang, salesmanId?: string): string {
  const q = new URLSearchParams({ status: "AKTIF", dari: rentang.dari, sampai: rentang.sampai });
  if (salesmanId) q.set("salesman", salesmanId);
  return `${ALAMAT_PESANAN_LAPANGAN}?${q.toString()}`;
}

/**
 * Alamat daftar Pelunasan yang isinya sama dengan angka "Pelunasan
 * terverifikasi" Kinerja sales lapangan: BKM terverifikasi yang DIVERIFIKASI
 * dalam rentang (hari WIB, `?dari=&sampai=` di Pelunasan memakai `verifiedAt`
 * pada tab Terverifikasi), opsional dicari nama salesnya.
 */
export function alamatPelunasanKinerja(rentang: Rentang, namaSales?: string): string {
  const q = new URLSearchParams({ status: "TERVERIFIKASI", dari: rentang.dari, sampai: rentang.sampai });
  if (namaSales?.trim()) q.set("cari", namaSales.trim());
  return `/backoffice/pelunasan?${q.toString()}`;
}


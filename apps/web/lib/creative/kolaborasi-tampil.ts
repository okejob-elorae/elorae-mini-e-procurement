/**
 * Bentuk tampilan kolaborasi — murni, aman untuk klien.
 */

import type { StatusTone } from "@/components/ui/status-pill";
import { isJalurKeluar, type Tahap } from "./tahap";

/**
 * Nada pil tahap. Mengikuti makna warna KOL Manager (§3.1) dalam lima nada
 * Elorae: menunggu orang lain = kuning, sedang jalan = biru, hasil = hijau,
 * keluar jalur = merah, prospek = abu.
 */
export function nadaTahap(t: Tahap): StatusTone {
  if (isJalurKeluar(t)) return "attention";
  switch (t) {
    case "PROSPEK":
      return "inactive";
    case "DEAL":
    case "SAMPEL_DIKIRIM":
    case "DRAF":
      return "waiting";
    case "TAYANG":
    case "ANGKA_MASUK":
    case "DIBAYAR":
    case "SELESAI":
      return "settled";
    default:
      return "progress";
  }
}

export type AlamatKirim = {
  name: string;
  recipientName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
};

/** Alamat dan nomor HP wajib ada sebelum sampel dikirim. */
export function alamatLengkap(a: AlamatKirim): boolean {
  return Boolean(a.address?.trim()) && Boolean(a.phone?.trim());
}

/**
 * Teks "Salin alamat": nama penerima, no. HP, alamat, lalu "kota, provinsi,
 * kode pos" — bentuk yang ditempel ke aplikasi kurir. Baris kosong dilewati.
 */
export function teksAlamatKirim(a: AlamatKirim): string {
  const kota = [a.city, a.province, a.postalCode].map((x) => x?.trim()).filter(Boolean).join(", ");
  return [a.recipientName?.trim() || a.name.trim(), a.phone?.trim(), a.address?.trim(), kota]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}

/** Kotak riwayat KOL: biru bila ROAS ≥ 1, kuning bila kurang (atau belum ada angka). */
export function nadaRiwayat(roas: number | null): "baik" | "waspada" {
  return roas !== null && roas >= 1 ? "baik" : "waspada";
}

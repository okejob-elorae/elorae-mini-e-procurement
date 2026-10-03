import { nomorWhatsApp } from "@/lib/salesman/dasbor";

/**
 * Aturan data pembeli (pelanggan toko) — murni, aman dipakai di layar HP.
 *
 * Pelanggan milik TOKO, bukan milik SPG: dicatat sekali per nomor HP per toko
 * (`StoreCustomer @@unique([storeId, phone])`), dan SPG mana pun di toko itu
 * melihat orang yang sama. Pelanggan toko lain tidak pernah terlihat.
 *
 * Nomor HP disimpan dalam bentuk internasional tanpa + (`62812…`) lewat
 * `nomorWhatsApp` — bentuk yang sama dengan yang dicatat layar jual — dan hanya
 * nomor HP yang diterima: tujuannya dihubungi lewat WhatsApp, telepon rumah
 * tidak pernah membaca pesannya. Persetujuan dihubungi lewat WhatsApp WAJIB
 * (UU PDP); tanggalnya disimpan di `consentAt`.
 */

export const BATAS_NAMA_PELANGGAN = 100;
export const BATAS_CATATAN_PELANGGAN = 500;

/** Nama tindakan jejak pelanggan (`AuditLog.action`). */
export const JEJAK_PELANGGAN = {
  DIBUAT: "CUSTOMER_CREATED",
  DIUBAH: "CUSTOMER_UPDATED",
} as const;

export const ENTITAS_PELANGGAN = "StoreCustomer";

export type KodeTolakPelanggan =
  | "NAMA_WAJIB"
  | "NAMA_TERLALU_PANJANG"
  | "HP_TIDAK_VALID"
  | "PERSETUJUAN_WAJIB"
  | "CATATAN_TERLALU_PANJANG";

/** Spasi berlebih dirapikan; nama tetap seperti diketik SPG. */
export function rapikanNamaPelanggan(nama: string | null | undefined): string {
  return (nama ?? "").replace(/\s+/g, " ").trim();
}

/** Bentuk simpan `62812…` → bentuk yang dibaca orang Indonesia `0812…`. */
export function hpLokal(phone: string | null | undefined): string {
  const angka = (phone ?? "").replace(/\D/g, "");
  if (!angka) return "";
  return angka.startsWith("62") ? `0${angka.slice(2)}` : angka;
}

/**
 * Nomor HP yang disamarkan untuk layar kantor: `0812****7890`. Data pribadi —
 * kantor cukup bisa membedakan dua pelanggan, tidak perlu bisa menghubunginya.
 * Nomor yang terlalu pendek untuk disisakan depan-belakangnya disamarkan seluruhnya.
 */
export function samarkanHp(phone: string | null | undefined): string {
  const lokal = hpLokal(phone);
  if (lokal.length < 9) return "*".repeat(Math.max(lokal.length, 4));
  return `${lokal.slice(0, 4)}****${lokal.slice(-4)}`;
}

/** Kata kunci pencarian nomor: "0812…" dan "812…" dicari sebagai "62812…", bentuk simpannya. */
export function hpUntukCari(teks: string | null | undefined): string {
  const angka = (teks ?? "").replace(/\D/g, "");
  return angka.startsWith("0") ? `62${angka.slice(1)}` : angka.startsWith("8") ? `62${angka}` : angka;
}

export type IsianPelanggan = { nama: string; hp: string; catatan?: string | null; setuju?: boolean };
export type IsianPelangganSah = { nama: string; hp: string; catatan: string | null };

/**
 * Periksa isian pelanggan. `butuhSetuju` benar untuk pelanggan BARU dan untuk
 * nomor HP yang DIGANTI — persetujuan diberikan pemilik nomor, jadi nomor baru
 * butuh persetujuan baru.
 */
export function periksaIsianPelanggan(
  isian: IsianPelanggan,
  butuhSetuju: boolean,
): { ok: true; data: IsianPelangganSah } | { ok: false; code: KodeTolakPelanggan } {
  const nama = rapikanNamaPelanggan(isian.nama);
  if (!nama) return { ok: false, code: "NAMA_WAJIB" };
  if (nama.length > BATAS_NAMA_PELANGGAN) return { ok: false, code: "NAMA_TERLALU_PANJANG" };
  const hp = nomorWhatsApp(isian.hp);
  if (!hp) return { ok: false, code: "HP_TIDAK_VALID" };
  if (butuhSetuju && isian.setuju !== true) return { ok: false, code: "PERSETUJUAN_WAJIB" };
  const catatan = (isian.catatan ?? "").trim();
  if (catatan.length > BATAS_CATATAN_PELANGGAN) return { ok: false, code: "CATATAN_TERLALU_PANJANG" };
  return { ok: true, data: { nama, hp, catatan: catatan || null } };
}

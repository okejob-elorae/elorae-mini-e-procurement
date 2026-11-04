/**
 * Pembantu tampilan daftar, rincian dan formulir barang. Murni — boleh dipakai
 * komponen klien.
 */

export type JenisBawaan = "FABRIC" | "ACCESSORIES" | "FINISHED_GOOD";

const JENIS_BAWAAN: readonly string[] = ["FABRIC", "ACCESSORIES", "FINISHED_GOOD"];

export const jenisBawaan = (code: string): code is JenisBawaan => JENIS_BAWAAN.includes(code);

/**
 * Label jenis barang. Tiga jenis bawaan memakai label terjemahan (huruf kapital
 * hanya di awal, satu istilah: "Kain", "Barang jadi") — nama di master jenis
 * barang ("Kain / Fabric", "Barang Jadi") tidak dipakai untuknya. Jenis lain
 * memakai nama master sesuai bahasa.
 */
export function labelJenisBarang(
  master: { code: string; nameId: string; nameEn: string },
  locale: string,
  labelBawaan: (code: JenisBawaan) => string,
): string {
  if (jenisBawaan(master.code)) return labelBawaan(master.code);
  return locale === "en" ? master.nameEn || master.nameId : master.nameId || master.nameEn;
}

/** Angka stok gaya Indonesia: "2.000", "12,5"; kosong atau tidak sah = 0. */
export function angkaStok(nilai: number | string | null | undefined): string {
  const n = Number(nilai ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

/** Kunci pesan `itemList.*` untuk penolakan hapus barang dari `deleteItem`. */
export function kunciGalatHapusBarang(messageKey: string): "errInUse" | "errDelete" {
  return messageKey === "cannotDeleteItemInUse" ? "errInUse" : "errDelete";
}

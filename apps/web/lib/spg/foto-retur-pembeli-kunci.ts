import { isR2KeyInFolder, isSafeR2KeyExt, isSafeR2KeySegment } from "@/lib/r2-key";

/**
 * Kunci R2 foto retur pembeli SPG — murni, hanya mengimpor `lib/r2-key` (aman di klien).
 *
 * Foto barang wajib saat melapor (P14, P77); foto struk pengembalian kasir wajib
 * setiap kali uangnya dicatat dikembalikan — saat melapor kalau uang sudah
 * telanjur dikembalikan, atau di langkah "Uang sudah dikembalikan" (P77).
 *
 *   spg-sale-returns/<storeId>/<kunci laporan>/<barang|struk>.<ext>
 *
 * `storeId` SELALU toko tetap SPG (`User.assignedStoreId`, dari server), dan
 * `<kunci laporan>` = `SpgSaleReturn.idempotencyKey` yang dibuat HP sekali per
 * formulir. Kuncinya pasti, jadi unggah ulang menimpa objek yang sama. Satu
 * aturan pengikat dipakai rute unggah, penulis, dan pembaca: foto struk di
 * tempat foto barang, atau foto laporan lain, ditolak.
 */

export const PREFIX_FOTO_RETUR_PEMBELI = "spg-sale-returns" as const;
export const JENIS_FOTO_RETUR_PEMBELI = ["barang", "struk"] as const;
export type JenisFotoReturPembeli = (typeof JENIS_FOTO_RETUR_PEMBELI)[number];

export function bacaJenisFotoReturPembeli(v: unknown): JenisFotoReturPembeli | null {
  return typeof v === "string" && (JENIS_FOTO_RETUR_PEMBELI as readonly string[]).includes(v) ? (v as JenisFotoReturPembeli) : null;
}

/** Folder foto satu laporan. Pemanggil sudah memeriksa kedua bagiannya dengan `isSafeR2KeySegment`. */
export function folderFotoReturPembeli(storeId: string, kunci: string): string {
  return `${PREFIX_FOTO_RETUR_PEMBELI}/${storeId}/${kunci}`;
}

/** Nama berkas (tanpa ekstensi) sebuah kunci yang sudah lolos `isR2KeyInFolder`. */
function berkasTanpaEkstensi(key: string): string {
  const file = key.slice(key.lastIndexOf("/") + 1);
  return file.slice(0, file.lastIndexOf("."));
}

/**
 * Sisi TULIS: kunci ini tepat foto `jenis` laporan `kunci` di toko `storeId` —
 * satu berkas di folder laporan itu, bernama jenisnya.
 */
export function kunciFotoReturPembeliSah(
  key: unknown,
  b: { storeId: string; kunci: string; jenis: JenisFotoReturPembeli },
): key is string {
  if (!isSafeR2KeySegment(b.storeId) || !isSafeR2KeySegment(b.kunci)) return false;
  if (!isR2KeyInFolder(key, folderFotoReturPembeli(b.storeId, b.kunci))) return false;
  return berkasTanpaEkstensi(key) === b.jenis;
}

/**
 * Sisi BACA: kunci tersimpan ini foto `jenis` di folder toko `storeId`
 * (`spg-sale-returns/<storeId>/<segmen aman>/<jenis>.<ext>`). Dipakai sebelum
 * merender foto dari kuncinya — tidak pernah dari URL yang tersimpan.
 */
export function kunciFotoReturPembeliTokoSah(key: unknown, b: { storeId: string; jenis: JenisFotoReturPembeli }): key is string {
  if (typeof key !== "string" || !isSafeR2KeySegment(b.storeId)) return false;
  const awal = `${PREFIX_FOTO_RETUR_PEMBELI}/${b.storeId}/`;
  if (!key.startsWith(awal)) return false;
  const sisa = key.slice(awal.length).split("/");
  if (sisa.length !== 2 || !isSafeR2KeySegment(sisa[0])) return false;
  const dot = sisa[1].lastIndexOf(".");
  if (dot === -1) return false;
  return sisa[1].slice(0, dot) === b.jenis && isSafeR2KeyExt(sisa[1].slice(dot + 1));
}

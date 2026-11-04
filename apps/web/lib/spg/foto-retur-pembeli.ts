import { urlFromKey } from "@/lib/r2";
import { kunciFotoReturPembeliTokoSah, type JenisFotoReturPembeli } from "./foto-retur-pembeli-kunci";

/**
 * URL tampil foto retur pembeli, hanya dari KUNCI tersimpannya dan hanya kalau
 * kunci itu masih tepat foto `jenis` di folder toko laporannya
 * (`kunciFotoReturPembeliTokoSah`). Kunci yang kosong atau tidak cocok → null:
 * layar menulis "tidak ada foto", tidak pernah merender alamat lain.
 */
export function urlFotoReturPembeli(r: { storeId: string; key: string | null }, jenis: JenisFotoReturPembeli): string | null {
  if (!r.key || !kunciFotoReturPembeliTokoSah(r.key, { storeId: r.storeId, jenis })) return null;
  return urlFromKey(r.key);
}

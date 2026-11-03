import type { JenisFotoReturPembeli } from "./foto-retur-pembeli-kunci";

/** Rute unggah foto retur pembeli SPG (R2). */
export const RUTE_FOTO_RETUR_PEMBELI = "/pwa/api/upload/spg-sale-return-photo";

export type IsiUnggahFotoReturPembeli = { berkas: Blob; nama: string; jenis: JenisFotoReturPembeli } & (
  | { kunci: string; returnId?: undefined }
  | { returnId: string; kunci?: undefined }
);

/**
 * Unggah satu foto retur pembeli dari HP (klien). `kunci` = kunci formulir
 * laporan (sebelum laporannya ada); `returnId` = langkah "Uang sudah
 * dikembalikan" (hanya foto struk). Kuncinya pasti di server, jadi mengulang
 * unggahan menimpa objek yang sama — dan kalau laporan/uangnya sudah tercatat,
 * server mengembalikan kunci yang TERSIMPAN tanpa menulis apa pun.
 *
 * Galatnya menurut sifatnya, supaya antrean HP bisa memilah:
 * - `TypeError` (dari fetch): sinyal putus — simpan di HP, coba lagi nanti;
 * - `Error("GAGAL")`: 401 (sesi habis) atau 5xx (R2 belum siap, server sibuk) — coba lagi;
 * - `Error(<KODE>)`: 4xx lain — foto atau laporannya ditolak, tidak akan berhasil diulang.
 */
export async function unggahFotoReturPembeli(isi: IsiUnggahFotoReturPembeli): Promise<{ key: string }> {
  const form = new FormData();
  form.append("file", isi.berkas, isi.nama);
  form.append("jenis", isi.jenis);
  if (isi.returnId !== undefined) form.append("returnId", isi.returnId);
  else form.append("kunci", isi.kunci);

  const res = await fetch(RUTE_FOTO_RETUR_PEMBELI, { method: "POST", body: form });
  if (!res.ok) {
    if (res.status === 401 || res.status >= 500) throw new Error("GAGAL");
    const galat = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof galat?.error === "string" && galat.error ? galat.error : "GAGAL");
  }
  const isiJawab = (await res.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof isiJawab?.key !== "string" || !isiJawab.key) throw new Error("GAGAL");
  return { key: isiJawab.key };
}

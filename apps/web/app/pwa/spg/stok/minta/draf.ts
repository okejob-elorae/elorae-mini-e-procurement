import { bacaAlasan, type AlasanPermintaan } from "@/lib/spg/saran-minta";

/**
 * Draf formulir minta kiriman di `localStorage` per toko.
 *
 * Gunanya bukan hanya HP yang terkunci: tombol "Minta" di layar analisa
 * membuka formulir ini dengan satu barang, lalu SPG kembali ke analisa dan
 * mengetuk "Minta" barang berikutnya — tanpa draf, barang pertama hilang.
 * Kunci kiriman ikut disimpan: permintaan yang jawabannya hilang di jalan lalu
 * dikirim ulang dari draf tetap tercatat satu kali.
 *
 * Draf lebih tua dari `UMUR_DRAF_MS` dibuang. Penyimpanan bisa dilarang (mode
 * privat): setiap akses dibungkus try/catch.
 */

export const UMUR_DRAF_MS = 3 * 24 * 60 * 60 * 1000;
export const kunciDraf = (storeId: string) => `elorae.spg.minta.${storeId}`;

export type BarisDraf = { kunci: string; qty: string; alasan: AlasanPermintaan };
export type DrafMinta = { baris: BarisDraf[]; catatan: string; kunciKirim: string | null; waktu: number };

/** Isi draf mentah → draf yang sah, atau null (rusak/kedaluwarsa). Murni, untuk dites. */
export function rapikanDraf(mentah: unknown, sekarang: number): DrafMinta | null {
  if (!mentah || typeof mentah !== "object") return null;
  const d = mentah as Record<string, unknown>;
  if (!Array.isArray(d.baris) || typeof d.waktu !== "number" || sekarang - d.waktu > UMUR_DRAF_MS || d.waktu > sekarang + 60_000) {
    return null;
  }
  const baris: BarisDraf[] = [];
  for (const b of d.baris) {
    if (!b || typeof b !== "object") continue;
    const x = b as Record<string, unknown>;
    const alasan = bacaAlasan(x.alasan);
    if (typeof x.kunci !== "string" || typeof x.qty !== "string" || !/^\d{0,5}$/.test(x.qty) || !alasan) continue;
    baris.push({ kunci: x.kunci, qty: x.qty, alasan });
  }
  return {
    baris,
    catatan: typeof d.catatan === "string" ? d.catatan.slice(0, 500) : "",
    kunciKirim: typeof d.kunciKirim === "string" && d.kunciKirim.length <= 100 ? d.kunciKirim : null,
    waktu: d.waktu,
  };
}

export function bacaDraf(storeId: string): DrafMinta | null {
  try {
    const mentah = window.localStorage.getItem(kunciDraf(storeId));
    if (!mentah) return null;
    const d = rapikanDraf(JSON.parse(mentah), Date.now());
    if (!d) window.localStorage.removeItem(kunciDraf(storeId));
    return d;
  } catch {
    return null;
  }
}

export function tulisDraf(storeId: string, draf: Omit<DrafMinta, "waktu">): void {
  try {
    if (draf.baris.length === 0 && draf.catatan.trim() === "") window.localStorage.removeItem(kunciDraf(storeId));
    else window.localStorage.setItem(kunciDraf(storeId), JSON.stringify({ ...draf, waktu: Date.now() }));
  } catch {
    // Penyimpanan penuh atau dilarang: daftar tetap hidup selama layar terbuka.
  }
}

export function hapusDraf(storeId: string): void {
  try {
    window.localStorage.removeItem(kunciDraf(storeId));
  } catch {
    // Penyimpanan dilarang: tidak ada yang perlu dihapus.
  }
}

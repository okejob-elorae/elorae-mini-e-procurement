/**
 * Total di layar saat dijual vs total yang dicatat server.
 *
 * Harga dan promo konter DINILAI ULANG di server (harga bisa berubah, promo bisa
 * berakhir atau baru dibuat kantor selagi nota menunggu sinyal). Yang tercatat
 * selalu hitungan server; kalau berbeda dari layar, nota di HP menyebutnya,
 * supaya SPG tidak kaget melihat angka lain di riwayat.
 *
 * Server tidak menyimpan total pratinjau, jadi catatannya tinggal di HP ini
 * (`localStorage`, per perangkat, paling banyak 50 nota terakhir). Hilang
 * (mode privat, data dibersihkan) berarti nota tidak menyebut selisihnya —
 * angkanya sendiri tetap angka server.
 */

const KUNCI = "elorae.spg.selisihTotal";
const BATAS = 50;

export type SelisihTotal = { pratinjau: number; tercatat: number };
type Catatan = Record<string, SelisihTotal & { waktu: number }>;

/** Penyimpanan seperti `localStorage` — disuntikkan supaya bisa dites. */
export type PenyimpananTeks = Pick<Storage, "getItem" | "setItem">;

/** Beda setengah rupiah atau lebih — sisa pembulatan bukan "harga berubah". */
export function totalBerbeda(pratinjau: number, tercatat: number): boolean {
  return Number.isFinite(pratinjau) && Number.isFinite(tercatat) && Math.abs(pratinjau - tercatat) >= 0.5;
}

function baca(s: PenyimpananTeks): Catatan {
  try {
    const mentah = s.getItem(KUNCI);
    const data = mentah ? (JSON.parse(mentah) as unknown) : null;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Catatan) : {};
  } catch {
    return {};
  }
}

/** Catat selisih satu nota. Total yang sama tidak dicatat. Tidak pernah melempar. */
export function catatSelisihTotal(s: PenyimpananTeks, spgSaleId: string, pratinjau: number, tercatat: number, waktu: number): void {
  if (!spgSaleId || !totalBerbeda(pratinjau, tercatat)) return;
  try {
    const semua = baca(s);
    semua[spgSaleId] = { pratinjau, tercatat, waktu };
    const urut = Object.entries(semua)
      .sort((a, b) => (b[1].waktu ?? 0) - (a[1].waktu ?? 0))
      .slice(0, BATAS);
    s.setItem(KUNCI, JSON.stringify(Object.fromEntries(urut)));
  } catch {
    // Penyimpanan penuh atau dilarang: nota tetap benar, hanya tanpa keterangan selisih.
  }
}

export function bacaSelisihTotal(s: PenyimpananTeks, spgSaleId: string): SelisihTotal | null {
  const c = baca(s)[spgSaleId];
  if (!c || typeof c.pratinjau !== "number" || typeof c.tercatat !== "number") return null;
  return totalBerbeda(c.pratinjau, c.tercatat) ? { pratinjau: c.pratinjau, tercatat: c.tercatat } : null;
}

function penyimpananPeramban(): PenyimpananTeks | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Untuk layar jual dan penyinkron (peramban). */
export function catatSelisihTotalDiHp(spgSaleId: string, pratinjau: number, tercatat: number): void {
  const s = penyimpananPeramban();
  if (s) catatSelisihTotal(s, spgSaleId, pratinjau, tercatat, Date.now());
}

/** Untuk layar nota (peramban). Mengembalikan teks JSON supaya aman dipakai sebagai snapshot `useSyncExternalStore`. */
export function bacaSelisihTotalDiHp(spgSaleId: string): string | null {
  const s = penyimpananPeramban();
  if (!s) return null;
  const c = bacaSelisihTotal(s, spgSaleId);
  return c ? JSON.stringify(c) : null;
}

/**
 * Berapa foto kunjungan yang SUDAH sampai ke server, diingat di HP.
 *
 * Aturan "wajib foto sebelum check-out" dijaga di HP (`CheckOutButton`). Dengan
 * sinyal, server memberi tahu jumlahnya (`bacaSyaratCheckOut`); tanpa sinyal,
 * HP hanya bisa menjumlahkan yang ia ingat: angka dari halaman toko / jawaban
 * server terakhir, ditambah foto yang ia unggah sendiri sesudahnya. Foto yang
 * masih di antrean dihitung terpisah (`photo-queue.ts`).
 *
 * Disimpan per kunjungan di `localStorage`, dibuang sesudah tiga hari dan
 * dibatasi 50 kunjungan terakhir. Dibersihkan saat keluar (`bersihkan.ts`).
 */

export const KUNCI_FOTO_TERKIRIM = "elorae.pwa.fotoTerkirim";
const UMUR_MS = 3 * 86_400_000;
const MAKS_KUNJUNGAN = 50;

export type PetaFotoTerkirim = Record<string, { n: number; t: number }>;

/** Murni: baca peta tersimpan; rusak = kosong. */
export function bacaPetaFoto(mentah: string | null): PetaFotoTerkirim {
  if (!mentah) return {};
  try {
    const d = JSON.parse(mentah) as unknown;
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    const hasil: PetaFotoTerkirim = {};
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      const x = v as { n?: unknown; t?: unknown } | null;
      if (x && typeof x.n === "number" && Number.isInteger(x.n) && x.n >= 0 && typeof x.t === "number") hasil[k] = { n: x.n, t: x.t };
    }
    return hasil;
  } catch {
    return {};
  }
}

/** Murni: buang yang kedaluwarsa dan simpan paling banyak `MAKS_KUNJUNGAN` yang terbaru. */
export function rapikanPetaFoto(peta: PetaFotoTerkirim, sekarang: number): PetaFotoTerkirim {
  const sisa = Object.entries(peta)
    .filter(([, v]) => v.t >= sekarang - UMUR_MS)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAKS_KUNJUNGAN);
  return Object.fromEntries(sisa);
}

/**
 * Murni: catat jumlah dari server. Tidak pernah MENURUNKAN angka yang ada —
 * foto yang baru diunggah HP ini bisa belum terlihat di halaman yang dimuat
 * lebih dulu.
 */
export function catatJumlah(peta: PetaFotoTerkirim, visitId: string, n: number, sekarang: number): PetaFotoTerkirim {
  const lama = peta[visitId]?.n ?? 0;
  return rapikanPetaFoto({ ...peta, [visitId]: { n: Math.max(lama, Math.max(0, Math.trunc(n))), t: sekarang } }, sekarang);
}

/** Murni: satu foto lagi sampai ke server. */
export function tambahSatu(peta: PetaFotoTerkirim, visitId: string, sekarang: number): PetaFotoTerkirim {
  return rapikanPetaFoto({ ...peta, [visitId]: { n: (peta[visitId]?.n ?? 0) + 1, t: sekarang } }, sekarang);
}

function simpanan(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function ubah(f: (p: PetaFotoTerkirim, sekarang: number) => PetaFotoTerkirim): void {
  const s = simpanan();
  if (!s) return;
  try {
    const sekarang = Date.now();
    s.setItem(KUNCI_FOTO_TERKIRIM, JSON.stringify(f(bacaPetaFoto(s.getItem(KUNCI_FOTO_TERKIRIM)), sekarang)));
  } catch {
    // Penyimpanan penuh atau diblokir: aturan foto jatuh ke "ambil satu foto lagi".
  }
}

/** Jumlah foto kunjungan ini di server, dari halaman toko atau jawaban server. */
export function catatFotoTerkirim(visitId: string, n: number): void {
  if (visitId) ubah((p, sekarang) => catatJumlah(p, visitId, n, sekarang));
}

/** Foto kunjungan ini baru saja terunggah dari antrean HP. */
export function tambahFotoTerkirim(visitId: string): void {
  if (visitId) ubah((p, sekarang) => tambahSatu(p, visitId, sekarang));
}

/** Foto kunjungan ini yang HP tahu sudah sampai ke server (0 bila tidak tahu). */
export function fotoTerkirimDiHp(visitId: string | null | undefined): number {
  if (!visitId) return 0;
  const s = simpanan();
  if (!s) return 0;
  try {
    return bacaPetaFoto(s.getItem(KUNCI_FOTO_TERKIRIM))[visitId]?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Sorot baris yang baru berubah (`components/gerak/useSorotBaris`).
 *
 * Dua jalan menyalakan satu baris:
 *  1. Aksi di daftar itu sendiri berhasil (setujui, tolak, verifikasi) —
 *     pemanggil menandainya langsung.
 *  2. Statusnya berbeda dari yang terakhir dilihat di daftar ini, misalnya
 *     pesanan yang baru disetujui di halaman rinciannya lalu orang kembali ke
 *     daftar. Catatan "terakhir dilihat" disimpan per tab (sessionStorage).
 *
 * Kunjungan pertama tidak menyalakan apa pun: tanpa catatan, tidak ada yang
 * bisa disebut "berubah".
 */

/** Lama latar menyala lalu memudar; sama dengan animasi `sorot-baru` di globals.css. */
export const DURASI_SOROT_MS = 1200;

/** Nama keyframes di globals.css — dipakai untuk mengenali akhir animasinya. */
export const NAMA_ANIMASI_SOROT = "sorot-baru";

/** Banyak baris yang diingat per daftar; yang paling lama tidak dilihat dibuang. */
export const BATAS_CATATAN_SOROT = 300;

export type TandaBaris = { id: string; tanda: string };
export type CatatanSorot = Record<string, string>;

/** Baca catatan tersimpan; apa pun yang bukan objek id → teks dianggap belum ada. */
export function bacaCatatan(mentah: string | null): CatatanSorot | null {
  if (!mentah) return null;
  let isi: unknown;
  try {
    isi = JSON.parse(mentah);
  } catch {
    return null;
  }
  if (!isi || typeof isi !== "object" || Array.isArray(isi)) return null;
  const hasil: CatatanSorot = {};
  for (const [id, tanda] of Object.entries(isi as Record<string, unknown>)) {
    if (typeof tanda === "string") hasil[id] = tanda;
  }
  return hasil;
}

/** Id baris yang tandanya berbeda dari catatan. Baris yang belum tercatat tidak dihitung. */
export function barisBerubah(
  catatan: CatatanSorot | null,
  baris: readonly TandaBaris[],
  abaikan: ReadonlySet<string> = new Set(),
): string[] {
  if (!catatan) return [];
  const hasil: string[] = [];
  const sudah = new Set<string>();
  for (const { id, tanda } of baris) {
    if (sudah.has(id)) continue;
    sudah.add(id);
    if (abaikan.has(id)) continue;
    const lama = catatan[id];
    if (lama !== undefined && lama !== tanda) hasil.push(id);
  }
  return hasil;
}

/**
 * Catatan baru: baris halaman ini ditulis paling akhir (paling baru dilihat),
 * baris dari halaman/saringan lain tetap diingat sampai batasnya.
 */
export function gabungCatatan(
  catatan: CatatanSorot | null,
  baris: readonly TandaBaris[],
  batas: number = BATAS_CATATAN_SOROT,
): CatatanSorot {
  const urut = new Map<string, string>(Object.entries(catatan ?? {}));
  for (const { id, tanda } of baris) {
    urut.delete(id);
    urut.set(id, tanda);
  }
  const lebih = urut.size - Math.max(0, batas);
  const entri = [...urut.entries()].slice(lebih > 0 ? lebih : 0);
  return Object.fromEntries(entri);
}

/** Satu teks yang mewakili isi daftar — dipakai sebagai dependensi efek. */
export function tandaGabungan(baris: readonly TandaBaris[]): string {
  return JSON.stringify(baris.map((b) => [b.id, b.tanda]));
}

/** Kebalikan `tandaGabungan`. Teks rusak → daftar kosong. */
export function uraiTanda(teks: string): TandaBaris[] {
  try {
    const isi: unknown = JSON.parse(teks);
    if (!Array.isArray(isi)) return [];
    return isi
      .filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string")
      .map(([id, tanda]) => ({ id, tanda }));
  } catch {
    return [];
  }
}

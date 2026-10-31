/**
 * Penghitung pengunjung counter SPG — aturan murni, aman di klien (tanpa
 * Prisma), supaya HP dan server memakai aturan yang sama.
 *
 * Satu baris `SpgVisitorCount` = satu SPG × satu toko × satu hari WIB. HP
 * menyimpan angkanya di `localStorage` (bisa menghitung tanpa sinyal) dan
 * mengirim angka MUTLAK beserta waktu ubahnya (`clientUpdatedAt`), bukan
 * "+1": kiriman yang diulang — antrean, tab yang terbangun, sinyal yang
 * putus-sambung — tidak pernah menggandakan hitungan. Server menyimpan kiriman
 * hanya bila waktu ubahnya LEBIH BARU dari yang tersimpan, jadi kiriman lama
 * yang tiba terlambat tidak menimpa angka yang lebih baru.
 *
 * Toko selalu toko tetap SPG dari server; HP tidak pernah mengirim toko.
 */

import { kunciHariWib } from "@/lib/dashboard/tren";
import { geserHari, kunciHariSah } from "@/lib/salesman/jadwal";

/** Hari paling lama yang masih diterima: hari ini dan tiga hari ke belakang. */
export const MUNDUR_MAKS_HARI_PENGUNJUNG = 3;
/** Batas wajar satu SPG satu hari; lebih dari ini hampir pasti salah ketuk berulang. */
export const MAKS_PENGUNJUNG = 10_000;
/**
 * Jam HP boleh maju dari jam server sebanyak ini. Lebih dari itu waktunya
 * dianggap rusak: baris dengan waktu jauh di depan akan "menang" melawan
 * setiap kiriman jujur sesudahnya.
 */
export const MAKS_MAJU_MENIT = 60;

export type KodeTolakPengunjung = "ISIAN_TIDAK_SAH" | "HARI_TERLALU_LAMA" | "HARI_DEPAN" | "WAKTU_TIDAK_SAH";

export type KirimanPengunjung = { day: string; count: number; clientUpdatedAt: Date };

/** Periksa kiriman HP. `sekarang` = jam server. */
export function periksaKirimanPengunjung(
  x: unknown,
  sekarang: Date,
): { ok: true; nilai: KirimanPengunjung } | { ok: false; kode: KodeTolakPengunjung } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  const o = x as Record<string, unknown>;
  if (!kunciHariSah(o.day)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  if (typeof o.count !== "number" || !Number.isInteger(o.count) || o.count < 0 || o.count > MAKS_PENGUNJUNG) {
    return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  }
  if (typeof o.clientUpdatedAt !== "string") return { ok: false, kode: "WAKTU_TIDAK_SAH" };
  const waktu = new Date(o.clientUpdatedAt);
  if (Number.isNaN(waktu.getTime())) return { ok: false, kode: "WAKTU_TIDAK_SAH" };
  if (waktu.getTime() > sekarang.getTime() + MAKS_MAJU_MENIT * 60_000) return { ok: false, kode: "WAKTU_TIDAK_SAH" };

  const hariIni = kunciHariWib(sekarang);
  if (o.day > hariIni) return { ok: false, kode: "HARI_DEPAN" };
  if (o.day < geserHari(hariIni, -MUNDUR_MAKS_HARI_PENGUNJUNG)) return { ok: false, kode: "HARI_TERLALU_LAMA" };
  return { ok: true, nilai: { day: o.day, count: o.count, clientUpdatedAt: waktu } };
}

/** Kiriman ditulis hanya bila lebih baru dari yang tersimpan; waktu SAMA = kiriman ulang, tidak ditulis. */
export function kirimanMenang(tersimpan: Date | null, masuk: Date): boolean {
  return tersimpan === null || masuk.getTime() > tersimpan.getTime();
}

/** Kode tolak yang tidak akan pernah berhasil bila diulang — HP berhenti mengirim hari itu. */
export const TOLAK_FINAL_PENGUNJUNG: readonly string[] = ["ISIAN_TIDAK_SAH", "HARI_TERLALU_LAMA", "HARI_DEPAN"];

// ─── Catatan di HP (localStorage) ─────────────────────────────────────────────

/**
 * Satu catatan per orang × toko × hari. `ubah` = waktu ketukan terakhir (ISO);
 * `terkirim` = nilai `ubah` yang terakhir DITERIMA server. Selama keduanya
 * berbeda, ada ketukan yang belum sampai server.
 */
export type CatatanPengunjung = { count: number; ubah: string; terkirim: string | null };

export const AWALAN_KUNCI_PENGUNJUNG = "elorae.spg.pengunjung.";

/**
 * Kunci `localStorage`. Orangnya ikut di kunci: satu HP bisa dipakai bergantian,
 * dan hitungan SPG sebelumnya tidak boleh terkirim atas nama SPG berikutnya.
 */
export function kunciCatatan(userId: string, storeId: string, day: string): string {
  return `${AWALAN_KUNCI_PENGUNJUNG}${userId}.${storeId}.${day}`;
}

/** Hari dari sebuah kunci milik orang × toko ini, atau null untuk kunci lain. */
export function hariDariKunci(kunci: string, userId: string, storeId: string): string | null {
  const awalan = `${AWALAN_KUNCI_PENGUNJUNG}${userId}.${storeId}.`;
  if (!kunci.startsWith(awalan)) return null;
  const day = kunci.slice(awalan.length);
  return kunciHariSah(day) ? day : null;
}

const waktuSah = (s: unknown): s is string => typeof s === "string" && !Number.isNaN(Date.parse(s));

/** Isi `localStorage` → catatan. Rusak atau asing → null (dianggap belum ada). */
export function bacaCatatan(mentah: string | null | undefined): CatatanPengunjung | null {
  if (!mentah) return null;
  let x: unknown;
  try {
    x = JSON.parse(mentah);
  } catch {
    return null;
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.count !== "number" || !Number.isInteger(o.count) || o.count < 0 || o.count > MAKS_PENGUNJUNG) return null;
  if (!waktuSah(o.ubah)) return null;
  return { count: o.count, ubah: o.ubah, terkirim: waktuSah(o.terkirim) ? o.terkirim : null };
}

export const perluDikirim = (c: CatatanPengunjung | null): c is CatatanPengunjung => !!c && c.terkirim !== c.ubah;

/**
 * Satu ketukan (+1 / −1). Angka tidak pernah di bawah nol. Waktu ubah selalu
 * MAJU, juga bila jam HP mundur sedikit di antara dua ketukan — kalau tidak,
 * ketukan kedua bisa kalah dari yang pertama di server.
 */
export function ketuk(c: CatatanPengunjung | null, delta: 1 | -1, sekarang: Date): CatatanPengunjung {
  const lama = c?.count ?? 0;
  const count = Math.min(MAKS_PENGUNJUNG, Math.max(0, lama + delta));
  const sebelum = c ? Date.parse(c.ubah) : Number.NEGATIVE_INFINITY;
  const waktu = Math.max(sekarang.getTime(), sebelum + 1);
  return { count, ubah: new Date(waktu).toISOString(), terkirim: c?.terkirim ?? null };
}

/** Angka di server untuk hari itu (milik orang ini). */
export type PengunjungServer = { count: number; clientUpdatedAt: string } | null;

/**
 * Gabungkan catatan HP dengan angka server: yang waktu ubahnya lebih baru
 * menang. Server lebih baru (SPG yang sama memakai HP lain) → angka server
 * diambil dan dianggap sudah terkirim.
 */
export function gabungDenganServer(lokal: CatatanPengunjung | null, server: PengunjungServer): CatatanPengunjung | null {
  if (!server) return lokal;
  if (!lokal || Date.parse(server.clientUpdatedAt) > Date.parse(lokal.ubah)) {
    return { count: server.count, ubah: server.clientUpdatedAt, terkirim: server.clientUpdatedAt };
  }
  if (Date.parse(server.clientUpdatedAt) === Date.parse(lokal.ubah)) return { ...lokal, terkirim: lokal.ubah };
  return lokal;
}

/**
 * Sesudah server menjawab kiriman berwaktu `dikirim`: catatan yang tidak
 * diketuk lagi selama kiriman berjalan ditandai terkirim; ketukan baru tetap
 * menunggu kiriman berikutnya. Jawaban server yang lebih baru diambil.
 */
export function setelahDiterima(lokal: CatatanPengunjung | null, dikirim: string, server: PengunjungServer): CatatanPengunjung | null {
  const tanda = lokal && lokal.ubah === dikirim ? { ...lokal, terkirim: dikirim } : lokal;
  return gabungDenganServer(tanda, server);
}

/** Hari ini menurut jam HP, kalender WIB. */
export const hariIniPengunjung = (sekarang: Date): string => kunciHariWib(sekarang);

/** Catatan yang sudah terlalu lama untuk diterima server — dibuang dari HP. */
export function catatanKedaluwarsa(day: string, hariIni: string): boolean {
  return day < geserHari(hariIni, -MUNDUR_MAKS_HARI_PENGUNJUNG);
}

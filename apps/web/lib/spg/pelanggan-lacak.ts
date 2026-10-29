/**
 * Pelacakan pelanggan SPG di kantor (`/backoffice/spg-pelanggan`) — aturan
 * murni, tanpa basis data, supaya bisa dites dan dipakai layar.
 *
 * Satu pelanggan = satu `StoreCustomer` (satu nomor di satu toko). Member
 * menyatukan nomor yang sama lintas toko, tetapi status pelanggan di sini
 * selalu milik TOKO itu: belanja di toko lain tidak membuat pelanggan toko ini
 * "aktif".
 *
 * Keputusan sementara 109 (pemilik 2026-10-20): "tidur" = tidak belanja
 * ≥ `hariTidur` hari (bawaan 90, Pengaturan → SPG → Member & pelanggan);
 * "kembali" = punya ≥ 2 nota.
 *
 * Semua hitungan hari memakai hari kalender WIB.
 */

import { kunciHariWib } from "@/lib/dashboard/tren";

const HARI_MS = 86_400_000;

// ─── Periode ─────────────────────────────────────────────────────────────────

/** Pilihan periode ringkasan, dalam hari (berakhir hari ini, WIB). */
export const PILIHAN_PERIODE_HARI = [30, 90, 180, 365] as const;
export const PERIODE_BAWAAN_HARI = 90;

export function bacaPeriodeHari(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return (PILIHAN_PERIODE_HARI as readonly number[]).includes(n) ? n : PERIODE_BAWAAN_HARI;
}

/** Awal hari WIB dari kunci "YYYY-MM-DD". */
const awalHari = (day: string) => new Date(`${day}T00:00:00+07:00`);

/** Geser kunci hari WIB sekian hari. */
function geserHari(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * HARI_MS).toISOString().slice(0, 10);
}

export type JendelaPeriode = {
  /** Awal hari WIB pertama periode (termasuk). */
  awal: Date;
  /** Awal hari WIB SESUDAH hari ini (tidak termasuk). */
  akhir: Date;
  hariAwal: string;
  hariAkhir: string;
  hari: number;
};

/** `hari` hari kalender WIB terakhir, termasuk hari ini. */
export function jendelaPeriode(sekarang: Date, hari: number): JendelaPeriode {
  const hariAkhir = kunciHariWib(sekarang);
  const hariAwal = geserHari(hariAkhir, -(hari - 1));
  return { awal: awalHari(hariAwal), akhir: awalHari(geserHari(hariAkhir, 1)), hariAwal, hariAkhir, hari };
}

/** Selisih hari kalender WIB dari `dulu` sampai `sekarang` (0 = hari yang sama). */
export function hariSejak(dulu: Date, sekarang: Date): number {
  return Math.round((Date.parse(`${kunciHariWib(sekarang)}T00:00:00Z`) - Date.parse(`${kunciHariWib(dulu)}T00:00:00Z`)) / HARI_MS);
}

// ─── Status satu pelanggan ───────────────────────────────────────────────────

export const STATUS_PELANGGAN = ["BARU", "AKTIF", "TIDUR", "BELUM_BELANJA"] as const;
export type StatusPelanggan = (typeof STATUS_PELANGGAN)[number];

export function bacaStatusPelanggan(raw: unknown): StatusPelanggan | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (STATUS_PELANGGAN as readonly string[]).includes(String(v)) ? (v as StatusPelanggan) : null;
}

/** Ringkasan nota satu pelanggan di tokonya (sepanjang waktu). */
export type NotaPelanggan = { nota: number; pertama: Date | null; terakhir: Date | null };

/**
 * Status pelanggan, diperiksa berurutan:
 * - BELUM_BELANJA: dicatat tanpa nota (mis. dari titip pesan).
 * - TIDUR: belanja terakhir ≥ `hariTidur` hari yang lalu — menang atas BARU,
 *   karena yang perlu dihubungi kembali adalah yang lama tidak datang.
 * - BARU: belanja pertama di dalam periode dan baru satu nota.
 * - AKTIF: selain itu.
 */
export function statusPelanggan(p: NotaPelanggan, o: { sekarang: Date; awalPeriode: Date; hariTidur: number }): StatusPelanggan {
  if (p.nota <= 0 || !p.terakhir) return "BELUM_BELANJA";
  if (hariSejak(p.terakhir, o.sekarang) >= o.hariTidur) return "TIDUR";
  if (p.nota === 1 && p.pertama && p.pertama >= o.awalPeriode) return "BARU";
  return "AKTIF";
}

// ─── Kategori favorit ────────────────────────────────────────────────────────

/**
 * Kategori dengan potong BERSIH terbanyak (dibeli − dikembalikan). Baris tanpa
 * kategori tidak dihitung; seri dipecah dengan nama kategori. null = belum ada
 * potong bersih berkategori.
 */
export function kategoriFavorit(baris: readonly { kategori: string | null; qty: number; kembali: number }[]): { nama: string; potong: number } | null {
  const per = new Map<string, number>();
  for (const b of baris) {
    if (!b.kategori) continue;
    const qty = Math.max(0, b.qty);
    const bersih = qty - Math.min(qty, Math.max(0, b.kembali));
    if (bersih <= 0) continue;
    per.set(b.kategori, (per.get(b.kategori) ?? 0) + bersih);
  }
  let hasil: { nama: string; potong: number } | null = null;
  for (const [nama, potong] of per) {
    if (!hasil || potong > hasil.potong || (potong === hasil.potong && nama.localeCompare(hasil.nama, "id") < 0)) hasil = { nama, potong };
  }
  return hasil;
}

// ─── Ringkasan satu toko (atau semua toko) ───────────────────────────────────

export type MasukanPelangganRingkas = NotaPelanggan & {
  phone: string;
  /** Nota pelanggan ini di toko ini di dalam periode. */
  notaPeriode: number;
};

export type RingkasLacak = {
  /** Pelanggan tercatat (`StoreCustomer`) — orang yang sama di dua toko dihitung dua. */
  pelanggan: number;
  /** Member aktif. Per toko: pelanggan toko ini yang nomornya member aktif. Semua toko: jumlah member aktif Elorae. */
  member: number;
  /** Semua nota SPG di dalam periode. */
  notaPeriode: number;
  /** Nota SPG di dalam periode yang mencatat pembelinya. */
  notaBerpembeli: number;
  /** notaBerpembeli ÷ notaPeriode (%), null tanpa nota. */
  cakupanPersen: number | null;
  /** Pelanggan yang belanja di dalam periode. */
  pembeliPeriode: number;
  /** Di antara `pembeliPeriode`, yang sudah punya ≥ 2 nota. */
  kembali: number;
  kembaliPersen: number | null;
  /** Belanja pertamanya jatuh di dalam periode. */
  baru: number;
  tidur: number;
  belumBelanja: number;
};

const persen = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/** Ringkas pelanggan satu toko. `memberAktif` = nomor member yang aktif. */
export function ringkasLacak(m: {
  pelanggan: readonly MasukanPelangganRingkas[];
  notaPeriode: number;
  notaBerpembeli: number;
  memberAktif: ReadonlySet<string>;
  sekarang: Date;
  awalPeriode: Date;
  hariTidur: number;
}): RingkasLacak {
  let member = 0;
  let pembeliPeriode = 0;
  let kembali = 0;
  let baru = 0;
  let tidur = 0;
  let belumBelanja = 0;
  for (const p of m.pelanggan) {
    if (m.memberAktif.has(p.phone)) member += 1;
    if (p.notaPeriode > 0) {
      pembeliPeriode += 1;
      if (p.nota >= 2) kembali += 1;
    }
    if (p.pertama && p.pertama >= m.awalPeriode) baru += 1;
    const s = statusPelanggan(p, { sekarang: m.sekarang, awalPeriode: m.awalPeriode, hariTidur: m.hariTidur });
    if (s === "TIDUR") tidur += 1;
    if (s === "BELUM_BELANJA") belumBelanja += 1;
  }
  return {
    pelanggan: m.pelanggan.length,
    member,
    notaPeriode: m.notaPeriode,
    notaBerpembeli: m.notaBerpembeli,
    cakupanPersen: persen(m.notaBerpembeli, m.notaPeriode),
    pembeliPeriode,
    kembali,
    kembaliPersen: persen(kembali, pembeliPeriode),
    baru,
    tidur,
    belumBelanja,
  };
}

/**
 * Gabungan semua toko: jumlah dijumlahkan, persen dihitung ulang dari
 * jumlahnya (bukan rata-rata persen per toko). `member` diganti jumlah member
 * aktif Elorae — satu member yang belanja di dua toko dihitung sekali.
 */
export function gabungRingkas(per: readonly RingkasLacak[], memberAktif: number): RingkasLacak {
  const jumlah = (k: keyof RingkasLacak) => per.reduce((s, r) => s + ((r[k] as number | null) ?? 0), 0);
  const notaPeriode = jumlah("notaPeriode");
  const notaBerpembeli = jumlah("notaBerpembeli");
  const pembeliPeriode = jumlah("pembeliPeriode");
  const kembali = jumlah("kembali");
  return {
    pelanggan: jumlah("pelanggan"),
    member: memberAktif,
    notaPeriode,
    notaBerpembeli,
    cakupanPersen: persen(notaBerpembeli, notaPeriode),
    pembeliPeriode,
    kembali,
    kembaliPersen: persen(kembali, pembeliPeriode),
    baru: jumlah("baru"),
    tidur: jumlah("tidur"),
    belumBelanja: jumlah("belumBelanja"),
  };
}

// ─── Daftar pelanggan satu toko ──────────────────────────────────────────────

export type BarisPelangganLacak = {
  id: string;
  nama: string;
  /** SELALU disamarkan. */
  hpSamar: string;
  dicatat: string;
  /** null = bukan member. `aktif: false` = member yang dinonaktifkan kantor. */
  member: { tingkat: string; aktif: boolean } | null;
  nota: number;
  /** Belanja bersih (sesudah retur) di toko ini, sepanjang waktu. */
  belanja: number;
  rataNota: number | null;
  pertama: string | null;
  terakhir: string | null;
  hariSejak: number | null;
  status: StatusPelanggan;
  favorit: { nama: string; potong: number } | null;
  titipTerbuka: number;
};

export type SaringMember = "ya" | "tidak";

export function bacaSaringMember(raw: unknown): SaringMember | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "ya" || v === "tidak" ? v : null;
}

/** Member aktif = "ya"; bukan member atau member nonaktif = "tidak". */
export const memberAktifBaris = (b: Pick<BarisPelangganLacak, "member">) => b.member?.aktif === true;

/**
 * Urutan daftar: belanja terakhir terbaru dulu (pelanggan yang baru tertidur
 * paling mudah diajak kembali), lalu yang belum pernah belanja, lalu nama.
 */
export function urutkanPelanggan<T extends Pick<BarisPelangganLacak, "terakhir" | "nama" | "id">>(baris: readonly T[]): T[] {
  return [...baris].sort((a, b) => {
    if (a.terakhir !== b.terakhir) {
      if (!a.terakhir) return 1;
      if (!b.terakhir) return -1;
      return a.terakhir < b.terakhir ? 1 : -1;
    }
    return a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id);
  });
}

/** Jumlah per status dan per keanggotaan — angka pada tombol saring. */
export type HitungSaringPelanggan = { semua: number; status: Record<StatusPelanggan, number>; member: Record<SaringMember, number> };

export function hitungSaringPelanggan(baris: readonly Pick<BarisPelangganLacak, "status" | "member">[]): HitungSaringPelanggan {
  const status = Object.fromEntries(STATUS_PELANGGAN.map((s) => [s, 0])) as Record<StatusPelanggan, number>;
  const member: Record<SaringMember, number> = { ya: 0, tidak: 0 };
  for (const b of baris) {
    status[b.status] += 1;
    member[memberAktifBaris(b) ? "ya" : "tidak"] += 1;
  }
  return { semua: baris.length, status, member };
}

export function saringPelanggan<T extends Pick<BarisPelangganLacak, "status" | "member">>(
  baris: readonly T[],
  s: { status: StatusPelanggan | null; member: SaringMember | null },
): T[] {
  return baris.filter(
    (b) => (!s.status || b.status === s.status) && (!s.member || (s.member === "ya") === memberAktifBaris(b)),
  );
}

// ─── Daftar member (seluruh Elorae) ──────────────────────────────────────────

export type BarisMemberKantor = {
  id: string;
  nama: string;
  /** SELALU disamarkan. */
  hpSamar: string;
  tingkat: string;
  kodeTingkat: string;
  /** Belanja bersih di semua toko dalam jendela tingkat (`periodeBulan`). */
  belanjaPeriode: number;
  /** Toko tempat nomor ini pernah punya nota, urut nama. */
  toko: { id: string; nama: string }[];
  bergabung: string;
  tokoBergabung: string;
  aktif: boolean;
  nonaktifSejak: string | null;
};

export type SaringStatusMember = "aktif" | "nonaktif";

export function bacaSaringStatusMember(raw: unknown): SaringStatusMember | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "aktif" || v === "nonaktif" ? v : null;
}

/** Member terbaru bergabung dulu. */
export function urutkanMember<T extends Pick<BarisMemberKantor, "bergabung" | "nama" | "id">>(baris: readonly T[]): T[] {
  return [...baris].sort((a, b) => (a.bergabung !== b.bergabung ? (a.bergabung < b.bergabung ? 1 : -1) : a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id)));
}

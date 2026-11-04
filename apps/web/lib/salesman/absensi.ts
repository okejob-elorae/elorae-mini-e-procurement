import { kunciHariWib } from "@/lib/dashboard/tren";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { BATAS_CATATAN, urlFotoSah } from "./biaya";
import { KUOTA_CUTI_BAWAAN, KUOTA_CUTI_MAKS, type JenisIzin } from "./izin";

/**
 * Absensi harian salesman (swafoto + GPS) — aturan murni, satu tempat.
 *
 * BAWAAN MATI. Absensi adalah kebijakan kepegawaian, bukan kebutuhan aplikasi
 * penjualan; pemilik yang menyalakannya di Pengaturan → Salesman. Satu orang
 * satu baris per hari kalender WIB (`Attendance.dayKey`), jadi dua ketukan
 * "Absen masuk" tetap satu absen.
 *
 * Terlambat TIDAK disimpan: dihitung saat dibaca terhadap jam masuk yang
 * berlaku sekarang. Kalau pemilik menggeser jam masuk, riwayat ikut dinilai
 * ulang — yang tersimpan hanya jam kedatangan yang sebenarnya.
 */

export const KUNCI_PENGATURAN_ABSENSI = "salesman.absensi";

export type PengaturanAbsensi = {
  aktif: boolean;
  selfieWajib: boolean;
  /** "HH:MM" WIB. Masuk sesudah menit ini dihitung terlambat. */
  jamMasukPaling: string;
  /** Hari KERJA cuti per orang per tahun WIB (lihat `lib/salesman/izin.ts`). */
  kuotaCutiTahunan: number;
};

export const PENGATURAN_ABSENSI_BAWAAN: PengaturanAbsensi = {
  aktif: false,
  selfieWajib: true,
  jamMasukPaling: "09:00",
  kuotaCutiTahunan: KUOTA_CUTI_BAWAAN,
};

export function kuotaCutiSah(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= KUOTA_CUTI_MAKS;
}

export function jamSah(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** `SystemSetting` → pengaturan. Kolom rusak jatuh ke bawaan per kolom, tidak dilempar. */
export function bacaPengaturanAbsensi(nilai: string | null | undefined): PengaturanAbsensi {
  if (!nilai) return PENGATURAN_ABSENSI_BAWAAN;
  let x: unknown;
  try {
    x = JSON.parse(nilai);
  } catch {
    return PENGATURAN_ABSENSI_BAWAAN;
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return PENGATURAN_ABSENSI_BAWAAN;
  const o = x as Record<string, unknown>;
  return {
    aktif: typeof o.aktif === "boolean" ? o.aktif : PENGATURAN_ABSENSI_BAWAAN.aktif,
    selfieWajib: typeof o.selfieWajib === "boolean" ? o.selfieWajib : PENGATURAN_ABSENSI_BAWAAN.selfieWajib,
    jamMasukPaling: jamSah(o.jamMasukPaling) ? o.jamMasukPaling : PENGATURAN_ABSENSI_BAWAAN.jamMasukPaling,
    // Baris yang disimpan sebelum kuota cuti ada tidak punya kolom ini → bawaan.
    kuotaCutiTahunan: kuotaCutiSah(o.kuotaCutiTahunan) ? o.kuotaCutiTahunan : PENGATURAN_ABSENSI_BAWAAN.kuotaCutiTahunan,
  };
}

/** Untuk MENYIMPAN: ketat, tanpa tambalan. */
export function periksaPengaturanAbsensi(x: unknown): PengaturanAbsensi | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.aktif !== "boolean" || typeof o.selfieWajib !== "boolean" || !jamSah(o.jamMasukPaling)) return null;
  if (!kuotaCutiSah(o.kuotaCutiTahunan)) return null;
  return { aktif: o.aktif, selfieWajib: o.selfieWajib, jamMasukPaling: o.jamMasukPaling, kuotaCutiTahunan: o.kuotaCutiTahunan };
}

/**
 * Layar absensi kantor: atasan salesman (`field_sales_orders:view`) — orang
 * yang sama yang membuka Pengaturan → Salesman. Tanpa izin baru.
 */
export function bolehMelihatAbsensi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW);
}

/** Isi kartu absen di beranda HP — semua jam sudah berupa teks WIB. */
export type DataKartuAbsen = {
  aktif: boolean;
  selfieWajib: boolean;
  jamMasukPaling: string;
  masuk: { jam: string; menitTerlambat: number } | null;
  pulang: { jam: string } | null;
  /** Menit; null selama belum absen pulang. */
  lamaKerja: number | null;
  /** Izin/sakit/cuti yang DISETUJUI untuk hari ini — kartu tidak meminta absen masuk. */
  izinHariIni: JenisIzin | null;
};

// ─── Jam & hari ──────────────────────────────────────────────────────────────

const WIB_MS = 7 * 3_600_000;

/** Hari kalender WIB, "YYYY-MM-DD" — kolom `Attendance.dayKey`. */
export const kunciHariAbsen = kunciHariWib;

function menitDariTengahMalamWib(d: Date): number {
  const ms = (d.getTime() + WIB_MS) % 86_400_000;
  return Math.floor(ms / 60_000);
}

function menitJam(jam: string): number {
  const j = jamSah(jam) ? jam : PENGATURAN_ABSENSI_BAWAAN.jamMasukPaling;
  const [h, m] = j.split(":").map(Number);
  return h * 60 + m;
}

/** 0 bila tepat waktu. Detik diabaikan: 09.00.59 masih "09.00". */
export function menitTerlambat(clockInAt: Date, jamMasukPaling: string): number {
  return Math.max(0, menitDariTengahMalamWib(clockInAt) - menitJam(jamMasukPaling));
}

export function lamaKerjaMenit(masuk: Date, pulang: Date | null): number | null {
  if (!pulang) return null;
  const selisih = Math.floor((pulang.getTime() - masuk.getTime()) / 60_000);
  return selisih >= 0 ? selisih : null;
}

export function koordinatSah(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function tautanPeta(lat: number | null, lng: number | null): string | null {
  return koordinatSah(lat, lng) ? `https://www.google.com/maps?q=${lat},${lng}` : null;
}

// ─── Masuk & pulang ──────────────────────────────────────────────────────────

export type KodeTolakMasuk =
  | "NONAKTIF"
  | "SUDAH_MASUK"
  | "SWAFOTO_WAJIB"
  | "SWAFOTO_TIDAK_SAH"
  | "LOKASI_WAJIB"
  | "CATATAN_TERLALU_PANJANG";

export function periksaMasuk(isi: {
  pengaturan: PengaturanAbsensi;
  sudahMasuk: boolean;
  selfieUrl: string | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
  akurasi: number | null | undefined;
  catatan: string | null | undefined;
}):
  | { ok: true; nilai: { selfieUrl: string | null; lat: number; lng: number; akurasi: number | null; catatan: string | null } }
  | { ok: false; kode: KodeTolakMasuk } {
  if (!isi.pengaturan.aktif) return { ok: false, kode: "NONAKTIF" };
  if (isi.sudahMasuk) return { ok: false, kode: "SUDAH_MASUK" };

  const selfieUrl = typeof isi.selfieUrl === "string" && isi.selfieUrl.trim() ? isi.selfieUrl.trim() : null;
  if (!selfieUrl && isi.pengaturan.selfieWajib) return { ok: false, kode: "SWAFOTO_WAJIB" };
  if (selfieUrl && !urlFotoSah(selfieUrl)) return { ok: false, kode: "SWAFOTO_TIDAK_SAH" };

  // Lokasi WAJIB: absen tanpa lokasi sama dengan tanda tangan tanpa nama.
  if (!koordinatSah(isi.lat, isi.lng)) return { ok: false, kode: "LOKASI_WAJIB" };

  const catatan = typeof isi.catatan === "string" ? isi.catatan.trim() : "";
  if (catatan.length > BATAS_CATATAN) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };

  // Akurasi hanya keterangan; nilai aneh dibuang, absennya tetap jalan.
  const akurasi =
    typeof isi.akurasi === "number" && Number.isFinite(isi.akurasi) && isi.akurasi >= 0 && isi.akurasi < 1_000_000
      ? Math.round(isi.akurasi)
      : null;

  return {
    ok: true,
    nilai: { selfieUrl, lat: isi.lat as number, lng: isi.lng as number, akurasi, catatan: catatan || null },
  };
}

/**
 * Pulang tidak dijaga saklar aktif: orang yang sudah absen masuk sebelum
 * absensi dimatikan tetap boleh menutup harinya.
 */
export function periksaPulang(
  absen: { clockOutAt: Date | null } | null,
): { ok: true } | { ok: false; kode: "BELUM_MASUK" | "SUDAH_PULANG" } {
  if (!absen) return { ok: false, kode: "BELUM_MASUK" };
  if (absen.clockOutAt) return { ok: false, kode: "SUDAH_PULANG" };
  return { ok: true };
}

// ─── SPG: absen mengikuti check-in ───────────────────────────────────────────
//
// SPG ditempatkan di SATU toko dan check-in GPS di sana adalah awal kerjanya,
// jadi selama absensi menyala, check-in SPG di toko tetapnya MENJADI absen
// masuk dan check-out-nya absen pulang — SPG tidak absen dua kali. Satu baris
// per hari WIB tetap dijaga `@@unique([userId, dayKey])`.
//
// Swafoto: check-in tidak memotret. Bila pemilik mewajibkan swafoto, absennya
// TETAP dicatat (tanpa swafoto) dan kantor melihat tandanya (`tanpaSwafoto`) —
// menahan absen berarti menahan check-in, dan tanpa check-in SPG tidak bisa
// berjualan. Penjualan tidak boleh berhenti karena kebijakan kepegawaian.

/** MASUK = buat absen; BUKA_LAGI = kembali sesudah check-out, jam pulang dihapus; LEWATI = tidak ada perubahan. */
export type PutusanAbsenCheckin = "MASUK" | "BUKA_LAGI" | "LEWATI";

export function putuskanAbsenCheckin(isi: {
  pengaturan: PengaturanAbsensi;
  absen: { clockOutAt: Date | null } | null;
}): PutusanAbsenCheckin {
  if (!isi.pengaturan.aktif) return "LEWATI";
  if (!isi.absen) return "MASUK";
  // Jam masuk tetap check-in PERTAMA hari itu; jam pulang = check-out TERAKHIR.
  return isi.absen.clockOutAt ? "BUKA_LAGI" : "LEWATI";
}

/** Seperti `periksaPulang`: tidak dijaga saklar aktif — hari yang sudah dibuka tetap boleh ditutup. */
export function putuskanAbsenCheckout(absen: { clockOutAt: Date | null } | null): "PULANG" | "LEWATI" {
  return absen && !absen.clockOutAt ? "PULANG" : "LEWATI";
}

/** Absen masuk tanpa swafoto padahal pemilik mewajibkannya — kantor diberi tanda, bukan absennya ditolak. */
export function tanpaSwafoto(absen: { selfieUrl: string | null }, pengaturan: Pick<PengaturanAbsensi, "selfieWajib">): boolean {
  return pengaturan.selfieWajib && !absen.selfieUrl;
}

// ─── Rekap ───────────────────────────────────────────────────────────────────

type BarisAbsen = { dayKey: string; clockInAt: Date; clockOutAt: Date | null };

export type RingkasanAbsen = { hadir: number; terlambat: number; menitTerlambat: number; tanpaPulang: number };

export function ringkasBulanAbsen(rows: BarisAbsen[], jamMasukPaling: string): RingkasanAbsen {
  const r: RingkasanAbsen = { hadir: 0, terlambat: 0, menitTerlambat: 0, tanpaPulang: 0 };
  for (const a of rows) {
    r.hadir += 1;
    const t = menitTerlambat(a.clockInAt, jamMasukPaling);
    if (t > 0) {
      r.terlambat += 1;
      r.menitTerlambat += t;
    }
    if (!a.clockOutAt) r.tanpaPulang += 1;
  }
  return r;
}

export type HariAbsen<T extends BarisAbsen> = {
  dayKey: string;
  hadir: boolean;
  menitTerlambat: number;
  absen: T | null;
  /** Izin/sakit/cuti yang disetujui untuk hari ini — hanya pada hari yang tidak dihadiri. */
  izin: JenisIzin | null;
};

/**
 * Setiap hari kalender satu bulan, terbaru dulu, sampai `hariIni` (hari depan
 * belum terjadi). Hari tanpa absen TETAP muncul — hari kosong adalah informasi,
 * bukan baris yang boleh dilompati. Hari kosong yang izinnya disetujui
 * (`petaHariIzin`) membawa jenisnya, supaya tidak terbaca "Tidak absen".
 */
export function susunHariBulan<T extends BarisAbsen>(
  bulan: string,
  rows: T[],
  jamMasukPaling: string,
  hariIni: string,
  izin: Map<string, JenisIzin> = new Map(),
): HariAbsen<T>[] {
  const [y, m] = bulan.split("-").map(Number);
  const jumlahHari = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const perHari = new Map(rows.map((r) => [r.dayKey, r]));
  const hasil: HariAbsen<T>[] = [];
  for (let d = jumlahHari; d >= 1; d--) {
    const dayKey = `${bulan}-${String(d).padStart(2, "0")}`;
    if (dayKey > hariIni) continue;
    const absen = perHari.get(dayKey) ?? null;
    hasil.push({
      dayKey,
      hadir: absen !== null,
      menitTerlambat: absen ? menitTerlambat(absen.clockInAt, jamMasukPaling) : 0,
      absen,
      izin: absen ? null : (izin.get(dayKey) ?? null),
    });
  }
  return hasil;
}

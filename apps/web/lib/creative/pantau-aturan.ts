/**
 * Pantau KOL lewat ekstensi Chrome — aturan murni, aman untuk klien.
 *
 * Rancangan: docs/superpowers/specs/2026-10-08-pantau-kol-ekstensi-design.md.
 * Pengaturan di `SystemSetting["kreatif.pantau"]`; baris kosong atau rusak
 * jatuh ke bawaan di bawah (keputusan sementara pemilik P4–P6, ingatkan untuk
 * dikonfirmasi). Klien boleh mengimpor nilai dari berkas ini;
 * `pantau-pengaturan.ts`, `pantau-writer.ts`, dan `pantau-queries.ts` hanya
 * `import type`.
 */

export const KUNCI_PANTAU = "kreatif.pantau";

export type PengaturanPantau = {
  /** Sakelar utama: mati = ekstensi tidak diberi tugas (alasan NONAKTIF). */
  aktif: boolean;
  /** Pengecekan per hari WIB, semua perangkat bersama. */
  kuotaHarian: number;
  /** "HH:MM" WIB; mulai inklusif, selesai eksklusif. */
  jamMulai: string;
  jamSelesai: string;
  jedaMinDetik: number;
  jedaMaksDetik: number;
  istirahatSetiapMenit: number;
  istirahatMinMenit: number;
  istirahatMaksMenit: number;
  /** Lama jeda otomatis sesudah captcha/login wall atau gagal beruntun. */
  jedaOtomatisMenit: number;
  /** Gagal berturut-turut sebanyak ini → perangkat dijeda. */
  maksGagalBeruntun: number;
  /** Akun KOL yang punya kolaborasi berjalan dicek setiap N hari. */
  hariAkunAktif: number;
  /** Akun lain dicek setiap N hari. */
  hariAkunLain: number;
  /** Anomali: pengikut naik lebih dari N% … */
  naikPengikutPersen: number;
  /** … dibanding catatan sebelumnya yang berjarak paling lama N hari. */
  naikPengikutHari: number;
  /** Anomali: ER akun turun lebih dari N% dibanding catatan ber-ER sebelumnya. */
  turunErPersen: number;
};

export const PANTAU_BAWAAN: PengaturanPantau = {
  aktif: true,
  kuotaHarian: 300,
  jamMulai: "08:00",
  jamSelesai: "17:00",
  jedaMinDetik: 15,
  jedaMaksDetik: 40,
  istirahatSetiapMenit: 45,
  istirahatMinMenit: 5,
  istirahatMaksMenit: 10,
  jedaOtomatisMenit: 60,
  maksGagalBeruntun: 3,
  hariAkunAktif: 7,
  hariAkunLain: 30,
  naikPengikutPersen: 30,
  naikPengikutHari: 14,
  turunErPersen: 40,
};

export const DAFTAR_KUNCI_PANTAU = Object.keys(PANTAU_BAWAAN) as (keyof PengaturanPantau)[];

type KunciAngka = Exclude<keyof PengaturanPantau, "aktif" | "jamMulai" | "jamSelesai">;

export const KUNCI_ANGKA_PANTAU = DAFTAR_KUNCI_PANTAU.filter(
  (k): k is KunciAngka => k !== "aktif" && k !== "jamMulai" && k !== "jamSelesai",
);

/** Batas wajar per kunci angka (inklusif). */
export const BATAS_PANTAU: Record<KunciAngka, { min: number; maks: number }> = {
  kuotaHarian: { min: 1, maks: 5000 },
  jedaMinDetik: { min: 5, maks: 600 },
  jedaMaksDetik: { min: 5, maks: 600 },
  istirahatSetiapMenit: { min: 10, maks: 240 },
  istirahatMinMenit: { min: 1, maks: 120 },
  istirahatMaksMenit: { min: 1, maks: 120 },
  jedaOtomatisMenit: { min: 5, maks: 1440 },
  maksGagalBeruntun: { min: 1, maks: 20 },
  hariAkunAktif: { min: 1, maks: 90 },
  hariAkunLain: { min: 1, maks: 365 },
  naikPengikutPersen: { min: 1, maks: 1000 },
  naikPengikutHari: { min: 1, maks: 90 },
  turunErPersen: { min: 1, maks: 100 },
};

const POLA_JAM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function keObjek(nilai: unknown): Record<string, unknown> | null {
  let x = nilai;
  if (typeof x === "string") {
    if (!x.trim()) return null;
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export type SebabGalatPantau = "BUKAN_ANGKA" | "DI_LUAR_BATAS" | "BUKAN_JAM" | "BUKAN_YA_TIDAK" | "URUTAN";

function periksaAngka(k: KunciAngka, v: unknown): SebabGalatPantau | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return "BUKAN_ANGKA";
  const b = BATAS_PANTAU[k];
  return v < b.min || v > b.maks ? "DI_LUAR_BATAS" : null;
}

/** Pasangan min/maks dan jam: yang kedua tidak boleh di bawah yang pertama. */
const PASANGAN: [keyof PengaturanPantau, keyof PengaturanPantau][] = [
  ["jedaMinDetik", "jedaMaksDetik"],
  ["istirahatMinMenit", "istirahatMaksMenit"],
];

/**
 * Pembaca pemaaf: kunci yang tidak sah memakai bawaannya sendiri-sendiri; pasangan
 * yang terbalik (min > maks, jam selesai ≤ mulai) kembali ke pasangan bawaannya.
 */
export function bacaPantau(nilai: unknown): PengaturanPantau {
  const o = keObjek(nilai);
  const hasil: PengaturanPantau = { ...PANTAU_BAWAAN };
  if (!o) return hasil;
  if (typeof o.aktif === "boolean") hasil.aktif = o.aktif;
  for (const k of ["jamMulai", "jamSelesai"] as const) {
    if (typeof o[k] === "string" && POLA_JAM.test(o[k] as string)) hasil[k] = o[k] as string;
  }
  for (const k of KUNCI_ANGKA_PANTAU) {
    if (o[k] !== undefined && periksaAngka(k, o[k]) === null) hasil[k] = o[k] as number;
  }
  for (const [a, b] of PASANGAN) {
    if ((hasil[a] as number) > (hasil[b] as number)) {
      (hasil as Record<string, unknown>)[a] = PANTAU_BAWAAN[a];
      (hasil as Record<string, unknown>)[b] = PANTAU_BAWAAN[b];
    }
  }
  if (hasil.jamMulai >= hasil.jamSelesai) {
    hasil.jamMulai = PANTAU_BAWAAN.jamMulai;
    hasil.jamSelesai = PANTAU_BAWAAN.jamSelesai;
  }
  return hasil;
}

export type GalatPantau = { kunci: keyof PengaturanPantau; sebab: SebabGalatPantau };
export type HasilValidasiPantau = { ok: true; pengaturan: PengaturanPantau } | { ok: false; galat: GalatPantau[] };

/**
 * Validasi untuk penyimpanan. Kunci yang tidak dikirim memakai bawaan; kunci
 * yang dikirim tapi salah DITOLAK (tidak diganti bawaan diam-diam).
 */
export function validasiPantau(input: unknown): HasilValidasiPantau {
  const o = keObjek(input);
  if (!o) return { ok: false, galat: [{ kunci: "kuotaHarian", sebab: "BUKAN_ANGKA" }] };
  const p: PengaturanPantau = { ...PANTAU_BAWAAN };
  const galat: GalatPantau[] = [];
  if (o.aktif !== undefined) {
    if (typeof o.aktif === "boolean") p.aktif = o.aktif;
    else galat.push({ kunci: "aktif", sebab: "BUKAN_YA_TIDAK" });
  }
  for (const k of ["jamMulai", "jamSelesai"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] === "string" && POLA_JAM.test(o[k] as string)) p[k] = o[k] as string;
    else galat.push({ kunci: k, sebab: "BUKAN_JAM" });
  }
  for (const k of KUNCI_ANGKA_PANTAU) {
    if (o[k] === undefined) continue;
    const sebab = periksaAngka(k, o[k]);
    if (sebab) galat.push({ kunci: k, sebab });
    else p[k] = o[k] as number;
  }
  const salah = new Set(galat.map((g) => g.kunci));
  for (const [a, b] of PASANGAN) {
    if (!salah.has(a) && !salah.has(b) && (p[a] as number) > (p[b] as number)) galat.push({ kunci: b, sebab: "URUTAN" });
  }
  if (!salah.has("jamMulai") && !salah.has("jamSelesai") && p.jamMulai >= p.jamSelesai) galat.push({ kunci: "jamSelesai", sebab: "URUTAN" });
  return galat.length ? { ok: false, galat } : { ok: true, pengaturan: p };
}

/** "HH:MM" WIB dari sebuah instan. */
export function jamWib(sekarang: Date): string {
  const bagian = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(sekarang);
  // Beberapa mesin menulis tengah malam sebagai "24:00".
  return bagian.startsWith("24") ? `00${bagian.slice(2)}` : bagian;
}

/** Di dalam jam kerja pemantauan (WIB): mulai inklusif, selesai eksklusif. */
export function dalamJamKerja(sekarang: Date, p: Pick<PengaturanPantau, "jamMulai" | "jamSelesai">): boolean {
  const j = jamWib(sekarang);
  return j >= p.jamMulai && j < p.jamSelesai;
}

// ── Status, jenis, kode ───────────────────────────────────────────────────

export const JENIS_TUGAS = ["PROFIL", "KONTEN"] as const;
export type JenisTugasPantau = (typeof JENIS_TUGAS)[number];

export const STATUS_TUGAS = ["ANTRE", "DIPINJAM", "SELESAI", "GAGAL", "DILEWATI"] as const;
export type StatusTugasPantau = (typeof STATUS_TUGAS)[number];

export const JENIS_LOG = ["HASIL", "MASALAH", "SAMBUNG", "JEDA", "LANJUT"] as const;
export type JenisLogPantau = (typeof JENIS_LOG)[number];

/** Kode yang dilaporkan ekstensi lewat `/masalah`. */
export const KODE_MASALAH = ["CAPTCHA", "LOGIN", "GAGAL_MUAT", "TIDAK_TERBACA", "TIDAK_DITEMUKAN", "PRIVAT"] as const;
export type KodeMasalah = (typeof KODE_MASALAH)[number];

/** Masalah yang membuat tugas diantrekan lagi (selama percobaan < `MAKS_PERCOBAAN`). */
export const KODE_ULANG: ReadonlySet<KodeMasalah> = new Set(["GAGAL_MUAT", "TIDAK_TERBACA"]);
/** Masalah perangkat, bukan tugas: perangkat dijeda, tugasnya kembali ke antrean tanpa menambah percobaan. */
export const KODE_JEDA: ReadonlySet<KodeMasalah> = new Set(["CAPTCHA", "LOGIN"]);
/** Hasil sah tentang akunnya: dicatat di `KolAccount.checkStatus`, tidak dihitung kegagalan perangkat. */
export const KODE_STATUS_AKUN: ReadonlySet<KodeMasalah> = new Set(["TIDAK_DITEMUKAN", "PRIVAT"]);

export const MAKS_PERCOBAAN = 3;
/** Lama pinjaman satu tugas. */
export const LEASE_MENIT = 5;
export const KODE_BERLAKU_MENIT = 15;
/** Jeda manual dari Elorae = sampai dilanjutkan; disimpan sebagai tanggal sangat jauh. */
export const JEDA_MANUAL_SAMPAI = new Date("2100-01-01T00:00:00.000Z");
export const ALASAN_JEDA = ["MANUAL", "CAPTCHA", "LOGIN", "GAGAL_BERUNTUN"] as const;
export type AlasanJeda = (typeof ALASAN_JEDA)[number];

export const STATUS_CEK_AKUN = ["OK", "TIDAK_DITEMUKAN", "PRIVAT", "TIDAK_TERBACA"] as const;
export type StatusCekAkun = (typeof STATUS_CEK_AKUN)[number];

/** Alasan `/tugas` tidak memberi tugas. */
export const ALASAN_TANPA_TUGAS = ["KUOTA_HABIS", "DI_LUAR_JAM", "DIJEDA", "ANTREAN_KOSONG", "NONAKTIF"] as const;
export type AlasanTanpaTugas = (typeof ALASAN_TANPA_TUGAS)[number];

/**
 * Kode galat API ekstensi dan aksi layar. Setiap kode punya teks di
 * `kreatifRuang.pantau.err.<KODE>` (kedua bahasa).
 */
export const KODE_GALAT_PANTAU = [
  "TOKEN_TIDAK_SAH",
  "KODE_TIDAK_SAH",
  "KODE_KEDALUWARSA",
  "MUATAN_TIDAK_SAH",
  "TUGAS_TIDAK_ADA",
  "TUGAS_TIDAK_AKTIF",
  "JENIS_BERBEDA",
  "AKUN_BERBEDA",
  "KONTEN_BERBEDA",
  "TIDAK_ADA_DI_ELORAE",
  "TERLALU_SERING",
  "BELUM_TAYANG",
  "ANGKA_KOSONG",
  "ANGKA_TIDAK_SAH",
  "TANGGAL_TIDAK_SAH",
  "TIDAK_DITEMUKAN",
  "PERANGKAT_TIDAK_ADA",
  "SUDAH_DICABUT",
  "NAMA_WAJIB",
  "NAMA_TERLALU_PANJANG",
  "TIDAK_VALID",
  "TANPA_AKSES",
  "GAGAL",
] as const;
export type KodeGalatPantau = (typeof KODE_GALAT_PANTAU)[number];

/** Nama perangkat (`KolPerangkat.nama`, VARCHAR(191) di MariaDB). */
export const NAMA_PERANGKAT_MAKS = 80;

/** `AuditLog.action` untuk tindakan dari layar Elorae. Jangan menulis nama tindakan sebagai string bebas. */
export const JEJAK_PANTAU = {
  KODE_DIBUAT: "KOL_MONITOR_DEVICE_CODE_CREATED",
  DIJEDA: "KOL_MONITOR_DEVICE_PAUSED",
  DILANJUTKAN: "KOL_MONITOR_DEVICE_RESUMED",
  DICABUT: "KOL_MONITOR_DEVICE_REVOKED",
  ANTREAN_DISUSUN: "KOL_MONITOR_QUEUE_BUILT",
  PENGATURAN_DIUBAH: "KOL_MONITOR_SETTINGS_UPDATED",
} as const;
export type JejakPantau = (typeof JEJAK_PANTAU)[keyof typeof JEJAK_PANTAU];

export const ENTITAS_PERANGKAT = "KolPerangkat";

// ── Kode sambung ──────────────────────────────────────────────────────────

/** 31 tanda tanpa yang mudah tertukar (0/O, 1/I/L): 31⁸ ≈ 8,5 × 10¹¹ kemungkinan. */
export const ALFABET_KODE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PANJANG_KODE = 8;

/** Rapikan ketikan kode ("abcd-efgh" → "ABCDEFGH"); `null` bila bentuknya pasti salah. */
export function normalKodeSambung(nilai: unknown): string | null {
  if (typeof nilai !== "string" || nilai.length > 40) return null;
  const k = nilai.replace(/[\s-]/g, "").toUpperCase();
  if (k.length !== PANJANG_KODE) return null;
  for (const c of k) if (!ALFABET_KODE.includes(c)) return null;
  return k;
}

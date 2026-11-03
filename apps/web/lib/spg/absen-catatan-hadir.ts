import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Catatan check-in toko SPG — aturan murni, aman untuk klien (keputusan pemilik 2026-11-02).
 *
 * Kalau SPG tidak mengisi jadwalnya, "back up nya adalah check in toko berupa file excel atau
 * kertas print manual" (P7d). Kantor memasukkannya — diketik per hari atau diunggah dari Excel —
 * oleh admin atau Admin Penjualan (`spg_attendance:record`, P7e), lalu Admin Keuangan
 * mencocokkannya dengan kertas/berkas aslinya (`spg_attendance:verify`, P61a). Untuk hari yang
 * dicakupnya, catatan yang SUDAH DIPERIKSA menggantikan jadwal dan check-in sistem (P61); catatan
 * yang belum diperiksa tidak dipakai sama sekali dan menahan pembayaran bulan itu (P60).
 *
 * Satu catatan per SPG × bulan (`SpgAttendanceRecord`), boleh hanya sebagian hari. Setiap hari
 * harus di masa kerjanya, bukan hari depan, dan muncul sekali.
 */

/**
 * Membuka Komisi SPG → Catatan check-in toko (B32): yang memasukkan (`spg_attendance:record`), yang
 * memeriksa (`spg_attendance:verify`), atau pengawas SPG (`spg_sales:view`, hanya membaca). Halaman
 * memagari dirinya sendiri — rute ini tidak ada di ROUTE_PERMISSIONS.
 */
export function bolehMembukaCatatanHadir(izin: string[] | undefined): boolean {
  const p = izin ?? [];
  return (
    hasPermission(p, PERMISSIONS.SPG_ATTENDANCE_RECORD) || hasPermission(p, PERMISSIONS.SPG_ATTENDANCE_VERIFY) || hasPermission(p, PERMISSIONS.SPG_SALES_VIEW)
  );
}

export const STATUS_CATATAN_HADIR = ["DIAJUKAN", "DIPERIKSA", "DIKEMBALIKAN"] as const;
export type StatusCatatanHadir = (typeof STATUS_CATATAN_HADIR)[number];

export const statusCatatanHadirDari = (s: string | null | undefined): StatusCatatanHadir | null =>
  s && (STATUS_CATATAN_HADIR as readonly string[]).includes(s) ? (s as StatusCatatanHadir) : null;

/** Bagian sebaris daftar kantor (`BarisCatatanHadirKantor`) yang dibaca dua antrean di bawah. */
export type BarisAntreanCatatanHadir = {
  sudahDibayar: boolean;
  hariPerlu: readonly string[];
  catatan: { status: StatusCatatanHadir } | null;
};

/**
 * SPG × bulan yang menunggu catatan check-in toko DIMASUKKAN: belum punya catatan, catatannya
 * DIKEMBALIKAN pemeriksa (yang memasukkan memperbaiki lalu mengajukannya lagi), atau sudah diperiksa
 * tetapi masih menyisakan hari tanpa dasar gaji. Bulan yang gajinya sudah dibayar tidak. SATU
 * predikat untuk angka Beranda `spgAttendanceToEnter` dan saringan `?perlu=masukkan` yang dibuka
 * tautannya — supaya angka dan daftarnya tidak pernah berbeda.
 */
export function perluDimasukkan(b: BarisAntreanCatatanHadir): boolean {
  if (b.sudahDibayar) return false;
  if (b.catatan === null) return true;
  return b.catatan.status === "DIKEMBALIKAN" || (b.catatan.status === "DIPERIKSA" && b.hariPerlu.length > 0);
}

/** Catatan yang menunggu diperiksa (DIAJUKAN), bulan yang belum dibayar — Beranda `spgAttendanceToCheck` dan `?perlu=periksa`. */
export function menungguDiperiksa(b: BarisAntreanCatatanHadir): boolean {
  return !b.sudahDibayar && b.catatan?.status === "DIAJUKAN";
}

/** `AuditLog.action` — label di `auditActions.actions.<KODE>`. */
export const JEJAK_CATATAN_HADIR = {
  DIMASUKKAN: "SPG_ATTENDANCE_RECORD_ENTERED",
  DIPERIKSA: "SPG_ATTENDANCE_RECORD_CHECKED",
  DIKEMBALIKAN: "SPG_ATTENDANCE_RECORD_RETURNED",
} as const;

export const ENTITAS_CATATAN_HADIR = "SpgAttendanceRecord";

/** Kategori `AdminNotification` (registri Izin). */
export const KATEGORI_NOTIF_CATATAN_HADIR = {
  PERLU: "SPG_ATTENDANCE_NEEDED",
  DIAJUKAN: "SPG_ATTENDANCE_SUBMITTED",
  DIKEMBALIKAN: "SPG_ATTENDANCE_RETURNED",
} as const;

export const SUMBER_CATATAN_HADIR = ["EXCEL", "MANUAL"] as const;
export type SumberCatatanHadir = (typeof SUMBER_CATATAN_HADIR)[number];

export const MAKS_CATATAN_HARI = 300;
export const MAKS_CATATAN_KEMBALI = 500;

export type HariCatatan = { day: string; kind: "KERJA" | "LIBUR"; present: boolean; note: string | null };

export type KodeGalatHariCatatan = "HARI_TIDAK_SAH" | "HARI_DEPAN" | "DI_LUAR_MASA_KERJA" | "HARI_GANDA" | "JADWAL_TIDAK_SAH" | "HADIR_TIDAK_SAH" | "CATATAN_TERLALU_PANJANG";

export type GalatBaris = { baris: number; kode: KodeGalatHariCatatan };

const POLA_HARI = /^\d{4}-\d{2}-\d{2}$/;

function hariSah(x: string): boolean {
  if (!POLA_HARI.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}

/** "KERJA"/"LIBUR" tanpa memandang huruf besar; null kalau bukan. */
export function bacaJenisHari(x: unknown): "KERJA" | "LIBUR" | null {
  const t = typeof x === "string" ? x.trim().toUpperCase() : "";
  return t === "KERJA" || t === "LIBUR" ? t : null;
}

/** "YA"/"TIDAK" (atau boolean) tanpa memandang huruf besar; null kalau bukan. */
export function bacaHadir(x: unknown): boolean | null {
  if (typeof x === "boolean") return x;
  const t = typeof x === "string" ? x.trim().toUpperCase() : "";
  if (t === "YA") return true;
  if (t === "TIDAK") return false;
  return null;
}

/**
 * Rapikan isian hari dari formulir atau berkas. `masa` = masa kerja SPG di bulan itu; `hariIni` =
 * hari WIB sekarang (hari depan ditolak). Semua galat dikumpulkan per baris (mulai 1) supaya kantor
 * melihat semuanya sekaligus; tidak ada yang ditulis selama ada satu galat.
 */
export function rapikanHariCatatan(
  x: unknown,
  masa: { hariAwal: string; hariAkhir: string } | null,
  hariIni: string,
): { ok: true; hari: HariCatatan[] } | { ok: false; galat: GalatBaris[] } {
  const daftar = Array.isArray(x) ? x : [];
  const galat: GalatBaris[] = [];
  const hari: HariCatatan[] = [];
  const terlihat = new Set<string>();
  daftar.forEach((raw, i) => {
    const baris = i + 1;
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const day = typeof r.day === "string" ? r.day.trim() : "";
    if (!hariSah(day)) return void galat.push({ baris, kode: "HARI_TIDAK_SAH" });
    if (day > hariIni) return void galat.push({ baris, kode: "HARI_DEPAN" });
    if (!masa || day < masa.hariAwal || day > masa.hariAkhir) return void galat.push({ baris, kode: "DI_LUAR_MASA_KERJA" });
    if (terlihat.has(day)) return void galat.push({ baris, kode: "HARI_GANDA" });
    const kind = bacaJenisHari(r.kind);
    if (!kind) return void galat.push({ baris, kode: "JADWAL_TIDAK_SAH" });
    const present = bacaHadir(r.present);
    if (present === null) return void galat.push({ baris, kode: "HADIR_TIDAK_SAH" });
    const note = typeof r.note === "string" && r.note.trim() ? r.note.trim() : null;
    if (note && note.length > MAKS_CATATAN_HARI) return void galat.push({ baris, kode: "CATATAN_TERLALU_PANJANG" });
    terlihat.add(day);
    hari.push({ day, kind, present, note });
  });
  if (daftar.length === 0) galat.push({ baris: 0, kode: "HARI_TIDAK_SAH" });
  if (galat.length > 0) return { ok: false, galat };
  return { ok: true, hari: hari.sort((a, b) => (a.day < b.day ? -1 : 1)) };
}

/** Potret hari untuk jejak: "YYYY-MM-DD" → "KERJA:YA" dst. */
export function potretHariCatatan(hari: ReadonlyArray<{ day: string; kind: string; present: boolean }>): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const h of [...hari].sort((a, b) => (a.day < b.day ? -1 : 1))) hasil[h.day] = `${h.kind}:${h.present ? "YA" : "TIDAK"}`;
  return hasil;
}

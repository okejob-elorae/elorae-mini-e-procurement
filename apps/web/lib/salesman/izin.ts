import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { BATAS_CATATAN, urlFotoSah } from "./biaya";

/**
 * Izin, sakit, dan cuti tim lapangan — aturan murni, satu tempat.
 *
 * Diajukan dari layar Absen di HP (salesman maupun SPG), diputuskan kantor di
 * `/backoffice/izin`. Hari yang izinnya DISETUJUI tampil sebagai Izin/Sakit/Cuti
 * di riwayat absen, bukan "Tidak absen".
 *
 * Semua tanggal adalah hari kalender WIB berbentuk "YYYY-MM-DD" (sama dengan
 * `Attendance.dayKey`). Perbandingan rentang memakai urutan teks — aman karena
 * bentuknya tetap.
 *
 * Yang dihitung adalah HARI KERJA orang yang izin: kuota cuti, jumlah hari di
 * rekap. Salesman bekerja Senin–Sabtu (`HARI_TIDAK_KERJA`) — Minggu di tengah
 * cutinya tetap tertulis "Cuti" di riwayat, tapi tidak memakan kuota. SPG
 * menjaga counter yang buka akhir pekan, jadi hari kerjanya diatur pemilik
 * (`spg.hariKerja`, bawaan Senin–Minggu) — lihat `hariTidakKerjaOrang`.
 */

export const JENIS_IZIN = ["IZIN", "SAKIT", "CUTI"] as const;
export type JenisIzin = (typeof JENIS_IZIN)[number];

export const STATUS_IZIN = ["DIAJUKAN", "DISETUJUI", "DITOLAK", "DIBATALKAN"] as const;
export type StatusIzin = (typeof STATUS_IZIN)[number];

/** Status yang masih "memegang" harinya: bentrok dan kuota menghitung keduanya. */
export const STATUS_IZIN_HIDUP: readonly StatusIzin[] = ["DIAJUKAN", "DISETUJUI"];

/**
 * Hari dalam seminggu yang BUKAN hari kerja SALESMAN (`getUTCDay`: 0 = Minggu).
 * Semua hitungan hari kerja di bawah menerima daftar libur orangnya sendiri
 * (`libur`) dengan ini sebagai bawaan; SPG memakai `hariTidakKerjaOrang`.
 */
export const HARI_TIDAK_KERJA: readonly number[] = [0];

// ─── Hari kerja SPG ──────────────────────────────────────────────────────────

/**
 * Hari kerja SPG — kebijakan pemilik, di Pengaturan → Salesman. Kunci sendiri,
 * BUKAN kolom di `salesman.absensi`: kartu absensi menyimpan JSON-nya utuh,
 * jadi kolom yang tidak ia kenal akan terhapus setiap kali kartu itu disimpan.
 * Disimpan sebagai `{ "hariKerja": [0..6] }` (0 = Minggu), urut naik.
 */
export const KUNCI_HARI_KERJA_SPG = "spg.hariKerja";

/** Bawaan: Senin–Minggu — counter di toko buka setiap hari, termasuk akhir pekan. */
export const HARI_KERJA_SPG_BAWAAN: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

const hariMingguSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 6;

/** `SystemSetting` → hari kerja SPG. Rusak atau kosong → bawaan; isian asing dibuang. */
export function bacaHariKerjaSpg(nilai: string | null | undefined): number[] {
  if (!nilai) return [...HARI_KERJA_SPG_BAWAAN];
  let x: unknown;
  try {
    x = JSON.parse(nilai);
  } catch {
    return [...HARI_KERJA_SPG_BAWAAN];
  }
  const daftar = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>).hariKerja : null;
  if (!Array.isArray(daftar)) return [...HARI_KERJA_SPG_BAWAAN];
  const hari = [...new Set(daftar.filter(hariMingguSah))].sort((a, b) => a - b);
  // Tanpa satu hari kerja pun, setiap ajuan izin akan ditolak "tanpa hari kerja".
  return hari.length > 0 ? hari : [...HARI_KERJA_SPG_BAWAAN];
}

/** Untuk MENYIMPAN: ketat — paling sedikit satu hari, tanpa ganda, tanpa nilai asing. */
export function periksaHariKerjaSpg(x: unknown): { hariKerja: number[] } | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const daftar = (x as Record<string, unknown>).hariKerja;
  if (!Array.isArray(daftar) || daftar.length === 0 || !daftar.every(hariMingguSah)) return null;
  if (new Set(daftar).size !== daftar.length) return null;
  return { hariKerja: [...daftar].sort((a, b) => a - b) };
}

/** Hari kerja → hari libur (pelengkapnya). */
export function hariTidakKerjaDari(hariKerja: readonly number[]): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !hariKerja.includes(d));
}

/**
 * Hari libur satu orang. SPG = pengguna dengan toko tetap (`assignedStoreId`);
 * selain itu salesman, yang hari kerjanya tetap Senin–Sabtu.
 */
export function hariTidakKerjaOrang(o: { spg: boolean; hariKerjaSpg: readonly number[] }): readonly number[] {
  return o.spg ? hariTidakKerjaDari(o.hariKerjaSpg) : HARI_TIDAK_KERJA;
}

/** Paling lama satu ajuan, dalam hari KALENDER (inklusif). */
export const MAKS_HARI_AJUAN = 30;

/**
 * Izin dan sakit sering baru dilaporkan sesudah harinya — orang sakit tidak
 * mengisi formulir pagi itu. Paling jauh sekian hari ke belakang. Cuti
 * direncanakan, jadi tidak boleh mundur sama sekali.
 */
export const MUNDUR_MAKS_HARI = 7;

/** Bawaan kuota cuti tahunan (hari kerja); diubah di Pengaturan → Salesman → Absensi. */
export const KUOTA_CUTI_BAWAAN = 12;
export const KUOTA_CUTI_MAKS = 365;

export const BATAS_ALASAN_IZIN = BATAS_CATATAN;

// ─── Siapa boleh apa ─────────────────────────────────────────────────────────
//
// Tanpa izin baru — memakai yang sudah ada di prod, tidak ada yang di-seed.

/** Mengajukan: setiap orang lapangan (salesman dan SPG). */
export function bolehMengajukanIzin(izin: string[] | undefined): boolean {
  return (izin ?? []).includes("pwa:access");
}

/**
 * Memutuskan (setuju/tolak/batalkan): atasan salesman — penyetuju pesanan
 * lapangan, orang yang sama yang menyetujui biaya perjalanannya.
 */
export function bolehMemutuskanIzin(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
}

/** Membuka daftar kantor: siapa pun yang melihat absensi, atau yang memutuskan. */
export function bolehMelihatIzin(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW) || bolehMemutuskanIzin(izin);
}

// ─── Tanggal ─────────────────────────────────────────────────────────────────

const HARI_MS = 86_400_000;

/** "YYYY-MM-DD" yang benar-benar ada di kalender (bukan 30 Februari). */
export function tanggalSah(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const ms = (dayKey: string) => Date.parse(`${dayKey}T00:00:00Z`);

/** Geser hari kalender (tanpa zona — kunci hari sudah WIB). */
export function geserHari(dayKey: string, n: number): string {
  return new Date(ms(dayKey) + n * HARI_MS).toISOString().slice(0, 10);
}

/** Jumlah hari kalender dari `mulai` sampai `selesai`, inklusif. */
function panjangHari(mulai: string, selesai: string): number {
  return Math.round((ms(selesai) - ms(mulai)) / HARI_MS) + 1;
}

export function hariKerja(dayKey: string, libur: readonly number[] = HARI_TIDAK_KERJA): boolean {
  return !libur.includes(new Date(ms(dayKey)).getUTCDay());
}

/**
 * Hari kerja di rentang inklusif. Dengan `tahun`, hanya yang jatuh di tahun itu
 * (kuota cuti dihitung per tahun WIB, dan satu cuti bisa melintasi tahun).
 */
export function hitungHariKerja(
  mulai: string,
  selesai: string,
  tahun?: string,
  libur: readonly number[] = HARI_TIDAK_KERJA,
): number {
  let n = 0;
  for (let d = mulai; d <= selesai; d = geserHari(d, 1)) {
    if (tahun !== undefined && !d.startsWith(`${tahun}-`)) continue;
    if (hariKerja(d, libur)) n += 1;
  }
  return n;
}

/** Tahun-tahun yang disentuh rentang, urut. */
export function tahunRentang(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  for (let y = Number(mulai.slice(0, 4)); y <= Number(selesai.slice(0, 4)); y++) hasil.push(String(y));
  return hasil;
}

type Rentang = { startDay: string; endDay: string };

/** Berbagi satu hari pun = bertumpuk. */
export function bertumpuk(a: Rentang, b: Rentang): boolean {
  return a.startDay <= b.endDay && b.startDay <= a.endDay;
}

// ─── Mengajukan ──────────────────────────────────────────────────────────────

/** Ajuan lain milik orang yang sama — untuk bentrok dan kuota. */
export type AjuanLain = { type: string; startDay: string; endDay: string; status: string };

const hidup = (a: AjuanLain) => (STATUS_IZIN_HIDUP as readonly string[]).includes(a.status);

/** Hari kerja cuti yang sudah dipegang (disetujui + menunggu) di satu tahun. */
export function terpakaiCuti(lain: AjuanLain[], tahun: string, libur: readonly number[] = HARI_TIDAK_KERJA): number {
  return lain
    .filter((a) => a.type === "CUTI" && hidup(a))
    .reduce((n, a) => n + hitungHariKerja(a.startDay, a.endDay, tahun, libur), 0);
}

export type RingkasanCuti = { tahun: string; kuota: number; disetujui: number; menunggu: number; sisa: number };

/** Kuota cuti satu tahun. `sisa` sudah dikurangi yang menunggu, dan tidak pernah negatif. */
export function ringkasCuti(
  rows: AjuanLain[],
  tahun: string,
  kuota: number,
  libur: readonly number[] = HARI_TIDAK_KERJA,
): RingkasanCuti {
  const jumlah = (status: StatusIzin) =>
    rows
      .filter((a) => a.type === "CUTI" && a.status === status)
      .reduce((n, a) => n + hitungHariKerja(a.startDay, a.endDay, tahun, libur), 0);
  const disetujui = jumlah("DISETUJUI");
  const menunggu = jumlah("DIAJUKAN");
  return { tahun, kuota, disetujui, menunggu, sisa: Math.max(0, kuota - disetujui - menunggu) };
}

export type KodeTolakIzin =
  | "JENIS_TIDAK_SAH"
  | "TANGGAL_TIDAK_SAH"
  | "SELESAI_SEBELUM_MULAI"
  | "TERLALU_PANJANG"
  | "TERLALU_LAMA_MUNDUR"
  | "CUTI_TIDAK_BOLEH_MUNDUR"
  | "TANPA_HARI_KERJA"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "FOTO_TIDAK_SAH"
  | "BENTROK";

export type TolakKuota = { ok: false; kode: "KUOTA_CUTI_HABIS"; tahun: string; sisa: number };

export type IzinSah = {
  jenis: JenisIzin;
  mulai: string;
  selesai: string;
  alasan: string;
  fotoUrl: string | null;
  hariKerja: number;
  /** Sakit lebih dari satu hari kerja tanpa surat dokter: tetap sah, layar menyarankan foto. */
  fotoDisarankan: boolean;
};

export type HasilPeriksaIzin = { ok: true; nilai: IzinSah } | { ok: false; kode: KodeTolakIzin } | TolakKuota;

/**
 * Pemeriksaan satu ajuan. Dipakai server (yang menentukan) dan formulir HP
 * (supaya penolakan terlihat sebelum foto diunggah).
 *
 * `lain` = ajuan lain orang yang sama, semua status; yang ditolak/dibatalkan
 * diabaikan di sini, bukan oleh pemanggil.
 */
export function periksaAjuanIzin(
  isi: { jenis: unknown; mulai: unknown; selesai: unknown; alasan: unknown; fotoUrl: unknown },
  konteks: {
    hariIni: string;
    lain: AjuanLain[];
    kuotaCutiTahunan: number;
    /** Hari libur PEMOHON (`hariTidakKerjaOrang`); tanpa ini = libur salesman. */
    hariTidakKerja?: readonly number[];
  },
): HasilPeriksaIzin {
  const libur = konteks.hariTidakKerja ?? HARI_TIDAK_KERJA;
  if (typeof isi.jenis !== "string" || !(JENIS_IZIN as readonly string[]).includes(isi.jenis)) {
    return { ok: false, kode: "JENIS_TIDAK_SAH" };
  }
  const jenis = isi.jenis as JenisIzin;
  if (!tanggalSah(isi.mulai) || !tanggalSah(isi.selesai)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const mulai = isi.mulai;
  const selesai = isi.selesai;
  if (selesai < mulai) return { ok: false, kode: "SELESAI_SEBELUM_MULAI" };
  if (panjangHari(mulai, selesai) > MAKS_HARI_AJUAN) return { ok: false, kode: "TERLALU_PANJANG" };

  if (jenis === "CUTI") {
    if (mulai < konteks.hariIni) return { ok: false, kode: "CUTI_TIDAK_BOLEH_MUNDUR" };
  } else if (mulai < geserHari(konteks.hariIni, -MUNDUR_MAKS_HARI)) {
    return { ok: false, kode: "TERLALU_LAMA_MUNDUR" };
  }

  const jumlahHariKerja = hitungHariKerja(mulai, selesai, undefined, libur);
  if (jumlahHariKerja === 0) return { ok: false, kode: "TANPA_HARI_KERJA" };

  // Kantor yang menyetujui harus tahu untuk apa — dan salesman yang ditolak
  // harus bisa menunjukkan apa yang ia tulis.
  const alasan = typeof isi.alasan === "string" ? isi.alasan.trim() : "";
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > BATAS_ALASAN_IZIN) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };

  const fotoUrl = typeof isi.fotoUrl === "string" && isi.fotoUrl.trim() ? isi.fotoUrl.trim() : null;
  if (fotoUrl !== null && !urlFotoSah(fotoUrl)) return { ok: false, kode: "FOTO_TIDAK_SAH" };

  // Satu hari hanya punya satu keterangan. Yang masih menunggu ikut dihitung:
  // dua ajuan yang menunggu bersamaan bisa sama-sama disetujui.
  const rentang = { startDay: mulai, endDay: selesai };
  if (konteks.lain.some((a) => hidup(a) && bertumpuk(a, rentang))) return { ok: false, kode: "BENTROK" };

  if (jenis === "CUTI") {
    const kuota = Math.max(0, konteks.kuotaCutiTahunan);
    for (const tahun of tahunRentang(mulai, selesai)) {
      const terpakai = terpakaiCuti(konteks.lain, tahun, libur);
      if (terpakai + hitungHariKerja(mulai, selesai, tahun, libur) > kuota) {
        return { ok: false, kode: "KUOTA_CUTI_HABIS", tahun, sisa: Math.max(0, kuota - terpakai) };
      }
    }
  }

  return {
    ok: true,
    nilai: {
      jenis,
      mulai,
      selesai,
      alasan,
      fotoUrl,
      hariKerja: jumlahHariKerja,
      fotoDisarankan: jenis === "SAKIT" && jumlahHariKerja > 1 && fotoUrl === null,
    },
  };
}

// ─── Keputusan ───────────────────────────────────────────────────────────────

/** PEMOHON = orang yang izin; KANTOR = penyetuju (`bolehMemutuskanIzin`). */
export type PelakuIzin = "PEMOHON" | "KANTOR";

/**
 * Perpindahan yang sah dan siapa yang boleh melakukannya. Ditolak dan
 * dibatalkan adalah akhir: yang ingin mengajukan lagi membuat ajuan baru, supaya
 * keputusan pertama tetap terbaca.
 */
export const TRANSISI_IZIN: Record<StatusIzin, Partial<Record<StatusIzin, PelakuIzin>>> = {
  DIAJUKAN: { DISETUJUI: "KANTOR", DITOLAK: "KANTOR", DIBATALKAN: "PEMOHON" },
  DISETUJUI: { DIBATALKAN: "KANTOR" },
  DITOLAK: {},
  DIBATALKAN: {},
};

export type KodeTolakPindahIzin = "TRANSISI_TIDAK_SAH" | "CATATAN_WAJIB" | "CATATAN_TERLALU_PANJANG";

/**
 * Catatan WAJIB saat kantor menolak atau membatalkan yang sudah disetujui —
 * orang yang izinnya dicabut harus tahu sebabnya. Selebihnya opsional.
 */
export function periksaPindahIzin(
  dari: string,
  ke: StatusIzin,
  pelaku: PelakuIzin,
  catatan: unknown,
): { ok: true; catatan: string | null } | { ok: false; kode: KodeTolakPindahIzin } {
  const boleh = (TRANSISI_IZIN as Record<string, Partial<Record<StatusIzin, PelakuIzin>> | undefined>)[dari];
  if (!boleh || boleh[ke] !== pelaku) return { ok: false, kode: "TRANSISI_TIDAK_SAH" };
  const c = typeof catatan === "string" ? catatan.trim() : "";
  if (c.length > BATAS_ALASAN_IZIN) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  if (!c && pelaku === "KANTOR" && ke !== "DISETUJUI") return { ok: false, kode: "CATATAN_WAJIB" };
  return { ok: true, catatan: c || null };
}

/**
 * Nama tindakan di `AuditLog`, satu tempat supaya jejaknya bisa dicari.
 * Pemohon yang MENARIK ajuannya dan kantor yang MEMBATALKAN izin yang sudah
 * disetujui berakhir di status yang sama, tapi artinya berbeda — namanya juga.
 */
export const JEJAK_IZIN = {
  DIAJUKAN: "LEAVE_REQUEST_SUBMITTED",
  DISETUJUI: "LEAVE_REQUEST_APPROVED",
  DITOLAK: "LEAVE_REQUEST_REJECTED",
  DITARIK: "LEAVE_REQUEST_WITHDRAWN",
  DIBATALKAN: "LEAVE_REQUEST_CANCELLED",
} as const;

export function jejakPindahIzin(ke: Exclude<StatusIzin, "DIAJUKAN">, pelaku: PelakuIzin): string {
  if (ke === "DIBATALKAN") return pelaku === "PEMOHON" ? JEJAK_IZIN.DITARIK : JEJAK_IZIN.DIBATALKAN;
  return JEJAK_IZIN[ke];
}

export const ENTITAS_IZIN = "LeaveRequest";

/**
 * Kategori catatan kantor. Penerimanya (`field_sales_orders:approve`) dan
 * tautannya (`/backoffice/izin?id=`) sudah terpasang di
 * `lib/notifications/admin-fanout.ts` dan `navigation.ts`; metadata wajib
 * membawa `leaveRequestId`.
 */
export const KATEGORI_NOTIF_IZIN = "LEAVE_REQUEST_SUBMITTED";

// ─── Riwayat absen ───────────────────────────────────────────────────────────

type RentangJenis = { type: string; startDay: string; endDay: string };

const jenisSah = (s: string): s is JenisIzin => (JENIS_IZIN as readonly string[]).includes(s);

/**
 * Hari → jenis izin untuk satu bulan ("YYYY-MM"), dari ajuan yang DISETUJUI.
 * Memuat semua hari di rentang (Minggu juga — ia memang sedang cuti), urut.
 */
export function petaHariIzin(disetujui: RentangJenis[], bulan: string): Map<string, JenisIzin> {
  const peta = new Map<string, JenisIzin>();
  const awal = `${bulan}-01`;
  const akhir = `${bulan}-31`;
  const urut = [...disetujui].sort((a, b) => a.startDay.localeCompare(b.startDay));
  for (const a of urut) {
    if (!jenisSah(a.type)) continue;
    const dari = a.startDay > awal ? a.startDay : awal;
    for (let d = dari; d <= a.endDay && d <= akhir; d = geserHari(d, 1)) {
      if (!d.startsWith(`${bulan}-`)) break;
      if (!peta.has(d)) peta.set(d, a.type);
    }
  }
  return new Map([...peta.entries()].sort(([x], [y]) => x.localeCompare(y)));
}

/** Jenis izin yang disetujui pada satu hari, atau null. */
export function izinPadaHari(disetujui: RentangJenis[], dayKey: string): JenisIzin | null {
  const a = disetujui.find((r) => r.startDay <= dayKey && dayKey <= r.endDay && jenisSah(r.type));
  return a ? (a.type as JenisIzin) : null;
}

export type HitungIzin = Record<JenisIzin, number>;

/**
 * Rekap per jenis: hari KERJA yang sudah lewat (≤ `sampai`) dan tidak
 * dihadiri. Hari yang tetap absen masuk dihitung hadir — orangnya datang.
 */
export function hitungHariIzinBulan(
  peta: Map<string, JenisIzin>,
  hadir: Set<string>,
  sampai: string,
  libur: readonly number[] = HARI_TIDAK_KERJA,
): HitungIzin {
  const n: HitungIzin = { IZIN: 0, SAKIT: 0, CUTI: 0 };
  for (const [d, jenis] of peta) {
    if (d > sampai || hadir.has(d) || !hariKerja(d, libur)) continue;
    n[jenis] += 1;
  }
  return n;
}

// ─── Teks server ─────────────────────────────────────────────────────────────

/**
 * Nama jenis untuk teks yang DISIMPAN (judul catatan kantor, isi kabar) — teks
 * itu ditulis sekali di server dan dibaca apa adanya, jadi tidak diterjemahkan
 * di layar. Layar sendiri memakai kunci i18n.
 */
export const NAMA_JENIS_IZIN: Record<JenisIzin, string> = { IZIN: "Izin", SAKIT: "Sakit", CUTI: "Cuti" };

const fmtTgl = (opsi: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("id-ID", { ...opsi, timeZone: "UTC" });
const TGL_PENUH = fmtTgl({ day: "numeric", month: "short", year: "numeric" });
const TGL_BULAN = fmtTgl({ day: "numeric", month: "short" });
const TGL_HARI = fmtTgl({ day: "numeric" });
const siang = (dayKey: string) => new Date(`${dayKey}T12:00:00Z`);

/**
 * "5 Okt 2026", "5–7 Okt 2026", "28 Sep – 2 Okt 2026", "28 Des 2026 – 2 Jan 2027".
 * Kunci hari sudah WIB, jadi diformat pada tengah hari UTC — tidak pernah
 * tergeser zona mesin yang menjalankannya.
 */
export function labelRentangIzin(mulai: string, selesai: string): string {
  if (!tanggalSah(mulai) || !tanggalSah(selesai)) return `${mulai} – ${selesai}`;
  if (mulai === selesai) return TGL_PENUH.format(siang(mulai));
  if (mulai.slice(0, 7) === selesai.slice(0, 7)) return `${TGL_HARI.format(siang(mulai))}–${TGL_PENUH.format(siang(selesai))}`;
  if (mulai.slice(0, 4) === selesai.slice(0, 4)) return `${TGL_BULAN.format(siang(mulai))} – ${TGL_PENUH.format(siang(selesai))}`;
  return `${TGL_PENUH.format(siang(mulai))} – ${TGL_PENUH.format(siang(selesai))}`;
}

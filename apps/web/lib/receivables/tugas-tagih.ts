/**
 * Tugas tagih — aturan murninya, tanpa basis data.
 *
 * Kantor menugaskan faktur-faktur terbuka SATU toko kepada satu orang lapangan
 * sampai sebuah tenggat. Tugasnya sendiri tidak mengubah uang sepeser pun:
 * yang mengurangi piutang tetap hanya klaim yang diverifikasi keuangan
 * (Aturan 1). Tugas hanya menyatakan SIAPA yang harus datang ke toko.
 *
 * Karena itu keadaan yang ditampilkan TIDAK disimpan — ia diturunkan setiap
 * kali dari keadaan faktur-fakturnya yang dihitung ulang (`daftarPiutang`).
 * Yang disimpan hanya tiga status: TERBUKA, SELESAI (dicap petugasnya, atau
 * otomatis begitu semua fakturnya lunas terverifikasi), dan DIBATALKAN.
 */

import type { KeadaanPiutang } from "./rules";
import { hariWib } from "./giro";

export const STATUS_TUGAS = {
  TERBUKA: "TERBUKA",
  SELESAI: "SELESAI",
  DIBATALKAN: "DIBATALKAN",
} as const;

export type StatusTugas = (typeof STATUS_TUGAS)[keyof typeof STATUS_TUGAS];

/** Nilai kolom `status` yang tidak dikenal dibaca sebagai TERBUKA — arah yang tetap menampilkan pekerjaan. */
export function bacaStatusTugas(nilai: string | null | undefined): StatusTugas {
  return nilai === STATUS_TUGAS.SELESAI || nilai === STATUS_TUGAS.DIBATALKAN ? nilai : STATUS_TUGAS.TERBUKA;
}

/**
 * Keadaan tampilan sebuah tugas.
 *
 * - `LUNAS`      semua fakturnya sudah lunas TERVERIFIKASI — tidak ada lagi yang ditagih.
 * - `DILAPORKAN` sisanya sudah dilaporkan dibayar (BKM menunggu verifikasi). Tampak
 *                beres bagi yang ditugasi, tapi BELUM lunas: klaim bukan pembayaran.
 * - `TERLAMBAT`  tenggatnya sudah lewat dan masih ada faktur yang belum dilaporkan.
 * - `BERJALAN`   selebihnya.
 * - `SELESAI` / `DIBATALKAN` mengikuti status yang tersimpan.
 */
export type KeadaanTugas = "BERJALAN" | "TERLAMBAT" | "DILAPORKAN" | "LUNAS" | "SELESAI" | "DIBATALKAN";

/** Satu faktur tugas apa adanya dari `daftarPiutang` — sisa yang DIHITUNG ULANG, bukan kolom cache. */
export type FakturTugas = { sisa: number; keadaan: KeadaanPiutang };

export function keadaanTugas(t: {
  status: StatusTugas;
  tenggat: Date | null;
  /** Hanya faktur yang masih ada; faktur yang sudah dihapus (impor dibatalkan) tidak ikut. */
  faktur: readonly FakturTugas[];
  hariIni: Date;
}): KeadaanTugas {
  if (t.status === STATUS_TUGAS.SELESAI) return "SELESAI";
  if (t.status === STATUS_TUGAS.DIBATALKAN) return "DIBATALKAN";

  /*
   * Tugas yang fakturnya sudah tidak ada satu pun TIDAK pernah dianggap lunas:
   * menutupnya "karena lunas" akan menulis ke jejak sesuatu yang tidak pernah
   * terjadi. Ia tetap tampil berjalan sampai kantor membatalkannya.
   */
  if (t.faktur.length > 0) {
    const lunas = (f: FakturTugas) => f.sisa <= 0;
    if (t.faktur.every(lunas)) return "LUNAS";
    if (t.faktur.every((f) => lunas(f) || f.keadaan === "klaim")) return "DILAPORKAN";
  }

  if (t.tenggat && hariWib(t.hariIni) > hariWib(t.tenggat)) return "TERLAMBAT";
  return "BERJALAN";
}

/** Tugas yang masih menuntut orang datang ke toko — yang dihitung di beranda HP. */
export function perluDitagih(keadaan: KeadaanTugas): boolean {
  return keadaan === "BERJALAN" || keadaan === "TERLAMBAT";
}

/**
 * Boleh ditutup otomatis: masih TERBUKA dan semua fakturnya lunas terverifikasi.
 *
 * `DILAPORKAN` sengaja TIDAK ikut — klaim yang masih menunggu bisa ditolak
 * keuangan, dan tugas yang sudah tertutup tidak akan menagihnya lagi.
 */
export function bolehDitutupOtomatis(status: StatusTugas, keadaan: KeadaanTugas): boolean {
  return status === STATUS_TUGAS.TERBUKA && keadaan === "LUNAS";
}

/**
 * Kolom `receivableIds` (JSON) → daftar id. Hanya string tak kosong yang
 * dipercaya, tanpa ganda — kolom JSON tidak dijaga skema apa pun.
 */
export function bacaIdFaktur(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const hasil: string[] = [];
  for (const v of json) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (id && !hasil.includes(id)) hasil.push(id);
  }
  return hasil;
}

export type AlasanGagalTugas =
  | "TANPA_FAKTUR"
  | "FAKTUR_TIDAK_DITEMUKAN"
  | "BEDA_TOKO"
  | "SUDAH_LUNAS"
  | "SUDAH_DITUGASKAN"
  | "BUKAN_PETUGAS_LAPANGAN"
  | "TENGGAT_LAMPAU";

/**
 * Periksa tugas baru sebelum ditulis.
 *
 * Satu tugas = satu toko: orang yang ditugasi datang ke SATU pintu, dan tugas
 * lintas toko tidak bisa dicentang selesai oleh siapa pun dengan jujur.
 *
 * Faktur yang sudah lunas ditolak SELURUHNYA, tidak disaring diam-diam —
 * daftar yang memuatnya sudah basi, dan penyusunnya perlu tahu itu.
 *
 * Satu faktur hanya boleh berada di SATU tugas terbuka. Kalau tidak, dua orang
 * datang menagih faktur yang sama ke toko yang sama — persis kebocoran yang
 * juga dijaga kontrabon.
 */
export function periksaTugasBaru(input: {
  storeId: string;
  receivableIds: readonly string[];
  /** Faktur yang DITEMUKAN untuk id di atas, dengan sisa yang dihitung ulang. */
  faktur: readonly { id: string; storeId: string; sisa: number }[];
  /** Faktur yang sedang berada di tugas lain yang masih TERBUKA. */
  sedangDitugaskan: ReadonlySet<string>;
  /** Yang ditugasi memang orang lapangan (salesman aktif, bukan SPG, bukan admin). */
  petugasLapangan: boolean;
  tenggat: Date | null;
  hariIni: Date;
}): { ok: true; receivableIds: string[] } | { ok: false; alasan: AlasanGagalTugas } {
  const ids = bacaIdFaktur(input.receivableIds);
  if (ids.length === 0) return { ok: false, alasan: "TANPA_FAKTUR" };

  const ada = new Map(input.faktur.map((f) => [f.id, f]));
  if (ids.some((id) => !ada.has(id))) return { ok: false, alasan: "FAKTUR_TIDAK_DITEMUKAN" };

  const faktur = ids.map((id) => ada.get(id)!);
  if (faktur.some((f) => f.storeId !== input.storeId)) return { ok: false, alasan: "BEDA_TOKO" };
  if (faktur.some((f) => f.sisa <= 0)) return { ok: false, alasan: "SUDAH_LUNAS" };
  if (ids.some((id) => input.sedangDitugaskan.has(id))) return { ok: false, alasan: "SUDAH_DITUGASKAN" };
  if (!input.petugasLapangan) return { ok: false, alasan: "BUKAN_PETUGAS_LAPANGAN" };

  // Tenggat hari ini masih boleh — "tagih hari ini" adalah tugas yang paling umum.
  if (input.tenggat && hariWib(input.tenggat) < hariWib(input.hariIni)) {
    return { ok: false, alasan: "TENGGAT_LAMPAU" };
  }
  return { ok: true, receivableIds: ids };
}

export type AlasanGagalTutup = "BUKAN_PETUGAS" | "SUDAH_DITUTUP" | "HASIL_WAJIB" | "ALASAN_WAJIB";

/**
 * "Sudah ditagih" — hanya yang ditugasi, hanya tugas yang masih terbuka, dan
 * WAJIB dengan catatan hasil. Tanpa catatan, centang ini tidak menyatakan apa
 * pun: kantor tidak tahu apakah toko berjanji, menolak, atau tutup.
 */
export function periksaSudahDitagih(t: {
  status: StatusTugas;
  assigneeId: string;
  userId: string;
  hasil: string | null | undefined;
}): { ok: true; hasil: string } | { ok: false; alasan: AlasanGagalTutup } {
  if (t.assigneeId !== t.userId) return { ok: false, alasan: "BUKAN_PETUGAS" };
  if (t.status !== STATUS_TUGAS.TERBUKA) return { ok: false, alasan: "SUDAH_DITUTUP" };
  const hasil = (t.hasil ?? "").trim();
  if (!hasil) return { ok: false, alasan: "HASIL_WAJIB" };
  return { ok: true, hasil };
}

/** Membatalkan tugas: hanya yang masih terbuka, dan alasannya wajib — ia satu-satunya jejak kenapa. */
export function periksaBatalTugas(t: {
  status: StatusTugas;
  alasan: string | null | undefined;
}): { ok: true; alasan: string } | { ok: false; alasan: AlasanGagalTutup } {
  if (t.status !== STATUS_TUGAS.TERBUKA) return { ok: false, alasan: "SUDAH_DITUTUP" };
  const alasan = (t.alasan ?? "").trim();
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  return { ok: true, alasan };
}

/**
 * Petugas bawaan di formulir: pemegang toko sekarang, atau — selama toko belum
 * punya pemegang — penjual fakturnya kalau semuanya dijual orang yang sama.
 * Sama dengan aturan penagih di layar Tagihan HP (`penagihPiutang`), supaya
 * tugasnya jatuh ke orang yang memang sudah melihat faktur itu di HP-nya.
 * Kosong kalau calonnya bukan orang lapangan: kantor memilih sendiri.
 */
export function petugasBawaan(opts: {
  pemegangId: string | null;
  penjualIds: readonly (string | null)[];
  petugasLapangan: ReadonlySet<string>;
}): string {
  const penjual = [...new Set(opts.penjualIds.filter((p): p is string => !!p))];
  const calon = opts.pemegangId ?? (penjual.length === 1 ? penjual[0] : null);
  return calon && opts.petugasLapangan.has(calon) ? calon : "";
}

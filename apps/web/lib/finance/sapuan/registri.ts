import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

/**
 * Registri SAPUAN dokumen tanpa jurnal (rancangan akuntansi & pajak lengkap,
 * prinsip 2). Jurnal otomatis dibuat best-effort SESUDAH dokumen di-commit;
 * yang gagal biasanya meninggalkan `JOURNAL_PENDING`, tetapi proses yang mati
 * di antara commit dan jurnal tidak meninggalkan apa-apa. Sapuan terjadwal
 * (runner-nya dibangun bagian A1) menanyai SETIAP sumber terdaftar "dokumen
 * mana yang seharusnya berjurnal tetapi belum", lalu memanggil `posting`.
 *
 * CARA MENDAFTARKAN SUMBER (setiap sumber jurnal baru WAJIB):
 * 1. Di modul fitur (mis. `lib/finance/lapangan/sapuan.ts`) panggil
 *    `daftarkanSumberSapuan({...})` di tingkat atas modul.
 * 2. Tambahkan SATU baris `import "@/lib/finance/<fitur>/sapuan";` ke
 *    `./semua.ts` (pakai alat Edit — berkas bersama). Runner hanya membaca
 *    sumber lewat `sumberSapuanTerdaftar()` di `./semua.ts`, jadi modul yang
 *    tidak diimpor di sana tidak pernah disapu.
 *
 * Aturan untuk setiap sumber:
 * - `sourceType` SAMA dengan yang dipakai `generateAutoJournal` (dan unik di
 *   registri). Mendaftar ulang `sourceType` yang sama MENGGANTIKAN yang lama
 *   (aman untuk HMR), bukan menambah.
 * - `cariTanpaJurnal` WAJIB menghormati `sejak`/`sampai` (tanggal dokumen) dan
 *   `batas` (jumlah maksimum) — tidak pernah menyapu seluruh tabel tanpa batas.
 *   Ia mengembalikan dokumen yang SEHARUSNYA berjurnal (status final, nilai
 *   bukan nol, sesudah tanggal mulai buku besar) dan belum punya `Journal`
 *   ber-(sourceType, sourceId) itu.
 * - `posting` idempoten (lewat `generateAutoJournal`) dan TIDAK melempar untuk
 *   kegagalan biasa — kembalikan `{ ok: false, code }`; ia sendiri yang menulis
 *   / menyelesaikan `JOURNAL_PENDING` seperti tombol posting ulang sumbernya.
 * - Tes yang memanggil `cariTanpaJurnal` memakai rentang tanggal dan data
 *   sendiri (basis data dipakai bersama).
 */

export type OpsiCariSapuan = {
  /** Tanggal dokumen paling awal (inklusif). */
  sejak: Date;
  /** Tanggal dokumen paling akhir (inklusif). */
  sampai: Date;
  /** Jumlah maksimum dokumen yang dikembalikan. */
  batas: number;
};

export type DokumenTanpaJurnal = {
  /** `sourceId` jurnalnya. */
  id: string;
  /** Tanggal dokumen (tanggal jurnalnya). */
  tanggal: Date;
  /** Nomor/nama dokumen untuk layar Integritas buku besar. */
  label: string;
};

export type SumberSapuan = {
  sourceType: string;
  /** Nama jenis dokumen, Bahasa Indonesia (mis. "Nota tagihan"). */
  label: string;
  cariTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]>;
  posting(id: string, olehUserId: string): Promise<GenerateAutoJournalResult>;
};

const DAFTAR: SumberSapuan[] = [];

export function daftarkanSumberSapuan(sumber: SumberSapuan): void {
  if (!sumber.sourceType.trim()) throw new Error("sourceType sumber sapuan kosong");
  const i = DAFTAR.findIndex((s) => s.sourceType === sumber.sourceType);
  if (i >= 0) DAFTAR[i] = sumber;
  else DAFTAR.push(sumber);
}

/**
 * Sumber yang sudah terdaftar SAAT INI, urut pendaftaran. Runner memakai
 * `sumberSapuanTerdaftar()` di `./semua.ts`, yang menjamin semua modul
 * sumber sudah diimpor lebih dulu.
 */
export function semuaSumberSapuan(): readonly SumberSapuan[] {
  return [...DAFTAR];
}

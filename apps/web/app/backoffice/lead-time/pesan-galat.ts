import { ZodError } from "zod";

/*
 * Lead time → kalimat galat untuk toast. Aksi lead time dulu mengirim
 * `err.message` mentah ke layar: JSON isu zod, "Forbidden: Insufficient
 * permissions", atau pesan Prisma berbahasa Inggris. Pesan yang sengaja ditulis
 * aksi (mis. "Nama proses sudah dipakai.") tidak lewat sini — ia dikembalikan
 * langsung, bukan dilempar.
 */

const PESAN_KOLOM: Record<string, string> = {
  name: "Nama wajib diisi, paling panjang 100 huruf.",
  days: "Lama harus bilangan bulat, paling sedikit 1 hari.",
  overrideDays: "Lama khusus harus bilangan bulat, paling sedikit 1 hari.",
  rateQty: "Per berapa pcs wajib diisi untuk proses per jumlah, paling sedikit 1.",
  overrideRateQty: "Per berapa pcs harus bilangan bulat, paling sedikit 1.",
  notes: "Catatan paling panjang 500 huruf.",
  description: "Deskripsi paling panjang 2.000 huruf.",
  sopInstructions: "Instruksi SOP paling panjang 5.000 huruf.",
  steps: "Isi paling sedikit satu langkah dengan proses yang dipilih.",
};

export const PESAN_TANPA_IZIN = "Anda tidak punya izin mengelola lead time.";
export const PESAN_SESI_HABIS = "Sesi Anda berakhir. Masuk lagi.";
export const PESAN_ISIAN_TIDAK_SAH = "Isian tidak sah. Muat ulang halaman lalu coba lagi.";

/** Galat yang dilempar di dalam aksi → kalimat Indonesia; selain yang dikenal memakai `cadangan`. */
export function pesanGalatLeadTime(err: unknown, cadangan: string): string {
  if (err instanceof ZodError) {
    const kolom = err.issues[0]?.path[0];
    return (typeof kolom === "string" && PESAN_KOLOM[kolom]) || PESAN_ISIAN_TIDAK_SAH;
  }
  if (err instanceof Error) {
    if ((err as { status?: unknown }).status === 403) return PESAN_TANPA_IZIN;
    if (err.message === "Unauthorized") return PESAN_SESI_HABIS;
  }
  return cadangan;
}

/** Galat tak terduga yang perlu dicatat di log server (bukan isian, izin, atau sesi). */
export function galatTakTerduga(err: unknown): boolean {
  if (err instanceof ZodError) return false;
  if (err instanceof Error && ((err as { status?: unknown }).status === 403 || err.message === "Unauthorized")) return false;
  return true;
}

/**
 * Nama sudah dipakai (unik di basis data). Galat isian zod TIDAK termasuk —
 * dulu nama kosong ikut terbaca "sudah dipakai" karena JSON isunya memuat "name".
 */
export function namaKembar(err: unknown): boolean {
  if (err instanceof ZodError || !(err instanceof Error)) return false;
  if ((err as { code?: unknown }).code === "P2002") return true;
  return /Unique constraint|Duplicate entry/i.test(err.message);
}

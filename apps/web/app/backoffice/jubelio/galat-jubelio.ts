/**
 * Hasil aksi server Jubelio: `{ ok: true, data }` atau `{ ok: false, code, rincian }`.
 *
 * Aksi Jubelio tidak melempar Error ke layar: di produksi Next.js menyamarkan
 * pesan Error menjadi pesan umum, dan pesan aslinya teks teknis berbahasa
 * Inggris dari apps/api atau basis data. Layar menerjemahkan `code` lewat
 * `jubelio.galat.<code>`; `rincian` (teks teknis) hanya tampil di balik
 * "Rincian".
 *
 * Berkas ini murni — dipakai aksi server dan komponen klien sekaligus.
 */

export const KODE_GALAT_JUBELIO = [
  "TANPA_AKSES",
  "LAYANAN_MATI",
  "LAYANAN_MENOLAK",
  "BAWAAN_BELUM_ADA",
  "ISIAN_TIDAK_SAH",
  "GAGAL",
] as const;

export type KodeGalatJubelio = (typeof KODE_GALAT_JUBELIO)[number];

export type GagalJubelio = { ok: false; code: KodeGalatJubelio; rincian?: string };

export type HasilJubelio<T> = { ok: true; data: T } | GagalJubelio;

export function gagalJubelio(code: KodeGalatJubelio, rincian?: string): GagalJubelio {
  return rincian ? { ok: false, code, rincian } : { ok: false, code };
}

/** Kode sebab jaringan yang berarti apps/api tidak bisa dihubungi sama sekali. */
const SEBAB_JARINGAN = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Balasan apps/api yang bukan 2xx. */
export function galatDariBalasanApi(status: number, rincian: string): GagalJubelio {
  if (status === 401 || status === 403) return gagalJubelio("TANPA_AKSES", rincian);
  // 502/503/504 = proksi di depan apps/api tidak menemukan layanannya.
  if (status === 502 || status === 503 || status === 504) return gagalJubelio("LAYANAN_MATI", rincian);
  return gagalJubelio("LAYANAN_MENOLAK", rincian);
}

/** Error yang terlempar: sesi/izin, jaringan ke apps/api, konfigurasi, atau lainnya. */
export function galatDariLemparan(err: unknown): GagalJubelio {
  const pesan = err instanceof Error ? err.message : String(err ?? "");
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403 || /^(Unauthorized|Forbidden)\b/.test(pesan)) {
    return gagalJubelio("TANPA_AKSES", pesan);
  }
  const sebab = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  const kodeSebab = typeof sebab === "string" ? sebab : "";
  if (
    pesan === "fetch failed" ||
    SEBAB_JARINGAN.has(kodeSebab) ||
    /INTERNAL_API_(URL|SECRET)/.test(pesan)
  ) {
    return gagalJubelio("LAYANAN_MATI", kodeSebab ? `${pesan} (${kodeSebab})` : pesan);
  }
  return gagalJubelio("GAGAL", pesan);
}

/** Menjalankan isi aksi; apa pun yang terlempar menjadi `{ ok: false, code }`. */
export async function jalankanAksiJubelio<T>(
  kerja: () => Promise<HasilJubelio<T>>,
): Promise<HasilJubelio<T>> {
  try {
    return await kerja();
  } catch (err) {
    const gagal = galatDariLemparan(err);
    if (gagal.code === "GAGAL") console.error("[jubelio] aksi gagal:", err);
    return gagal;
  }
}

/** Kunci terjemahan untuk sebuah kode (namespace `jubelio.galat`). */
export function kunciGalatJubelio(code: string): KodeGalatJubelio {
  return (KODE_GALAT_JUBELIO as readonly string[]).includes(code)
    ? (code as KodeGalatJubelio)
    : "GAGAL";
}

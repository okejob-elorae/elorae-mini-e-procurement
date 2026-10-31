/**
 * Ambang hari Ruang KOL (`SystemSetting["kreatif.ambang"]`), murni dan aman
 * untuk klien. Baris kosong atau rusak jatuh ke bawaan di bawah ini, yang
 * diubah pemilik di Kreatif → Pengaturan.
 *
 * Bawaan = keputusan sementara pemilik 2026-10-07 (ingatkan untuk dikonfirmasi).
 */

export const KUNCI_AMBANG = "kreatif.ambang";

export type AmbangKreatif = {
  /** Dihubungi/nego tanpa balasan lebih dari N hari → perlu follow-up. */
  followUpHari: number;
  /** Deal sampai sampel berangkat. */
  dealKeKirimHari: number;
  /** Sampel dikirim sampai diterima ("resi nyangkut"). */
  kirimKeTerimaHari: number;
  /** Sampel diterima sampai konten tayang. */
  terimaKeTayangHari: number;
  /** Tayang sampai angka pertama diisi (H+3). */
  tayangKeAngkaHari: number;
  /** Draf masuk sampai direview. */
  reviewDrafHari: number;
  /** Jatuh tempo bayar = tayang + N hari. */
  jatuhTempoBayarHari: number;
  /** Tanpa balasan lebih dari N hari → disarankan ditandai ghosting. */
  saranGhostingHari: number;
  /** Umur di satu tahap lebih dari N hari disorot merah. */
  umurTahapMerahHari: number;
};

export const AMBANG_BAWAAN: AmbangKreatif = {
  followUpHari: 3,
  dealKeKirimHari: 3,
  kirimKeTerimaHari: 7,
  terimaKeTayangHari: 5,
  tayangKeAngkaHari: 3,
  reviewDrafHari: 2,
  jatuhTempoBayarHari: 14,
  saranGhostingHari: 14,
  umurTahapMerahHari: 7,
};

export const DAFTAR_KUNCI_AMBANG = Object.keys(AMBANG_BAWAAN) as (keyof AmbangKreatif)[];

/** Batas yang masuk akal per kunci (inklusif). */
export const BATAS_AMBANG: Record<keyof AmbangKreatif, { min: number; maks: number }> = {
  followUpHari: { min: 1, maks: 60 },
  dealKeKirimHari: { min: 0, maks: 60 },
  kirimKeTerimaHari: { min: 1, maks: 60 },
  terimaKeTayangHari: { min: 1, maks: 90 },
  tayangKeAngkaHari: { min: 1, maks: 30 },
  reviewDrafHari: { min: 0, maks: 30 },
  jatuhTempoBayarHari: { min: 0, maks: 180 },
  saranGhostingHari: { min: 1, maks: 180 },
  umurTahapMerahHari: { min: 1, maks: 90 },
};

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

type SebabGalat = "BUKAN_ANGKA" | "DI_LUAR_BATAS";

function periksa(k: keyof AmbangKreatif, v: unknown): SebabGalat | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return "BUKAN_ANGKA";
  const b = BATAS_AMBANG[k];
  return v < b.min || v > b.maks ? "DI_LUAR_BATAS" : null;
}

/** Pembaca pemaaf: kunci yang tidak sah memakai bawaannya sendiri-sendiri. */
export function bacaAmbang(nilai: unknown): AmbangKreatif {
  const o = keObjek(nilai);
  const hasil = { ...AMBANG_BAWAAN };
  if (!o) return hasil;
  for (const k of DAFTAR_KUNCI_AMBANG) {
    if (o[k] !== undefined && periksa(k, o[k]) === null) hasil[k] = o[k] as number;
  }
  return hasil;
}

export type HasilValidasiAmbang =
  | { ok: true; ambang: AmbangKreatif }
  | { ok: false; galat: { kunci: keyof AmbangKreatif; sebab: SebabGalat }[] };

/**
 * Validasi untuk penyimpanan. Kunci yang tidak dikirim memakai bawaan; kunci
 * yang dikirim tapi salah DITOLAK (tidak diam-diam diganti bawaan) supaya
 * orang yang mengetik tahu isiannya tidak tersimpan.
 */
export function validasiAmbang(input: unknown): HasilValidasiAmbang {
  const o = keObjek(input);
  if (!o) return { ok: false, galat: DAFTAR_KUNCI_AMBANG.map((kunci) => ({ kunci, sebab: "BUKAN_ANGKA" as const })) };
  const ambang = { ...AMBANG_BAWAAN };
  const galat: { kunci: keyof AmbangKreatif; sebab: SebabGalat }[] = [];
  for (const k of DAFTAR_KUNCI_AMBANG) {
    if (o[k] === undefined) continue;
    const sebab = periksa(k, o[k]);
    if (sebab) galat.push({ kunci: k, sebab });
    else ambang[k] = o[k] as number;
  }
  return galat.length ? { ok: false, galat } : { ok: true, ambang };
}

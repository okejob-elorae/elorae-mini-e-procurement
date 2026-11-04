/**
 * Profil pajak perusahaan (`SystemSetting["pajak.profil"]`) — murni, aman
 * untuk komponen klien. Tipe + pembaca saja; layar pengaturannya dibangun
 * bagian pajak (B2/D5).
 *
 * Profil ini menentukan kewajiban PPh badan, BUKAN PPN (status PKP ada di
 * `./ppn`, `pajak.ppn`). Riset 2026-10-08 (bukan nasihat pajak):
 * - PP 20/2026 (sejak 22 April 2026, menggantikan PP 55/2022): PPh final 0,5%
 *   dari omzet bruto bulanan (sampai Rp4,8 M/tahun) hanya untuk orang pribadi,
 *   PT perorangan, dan koperasi. CV/firma/PT biasa yang sudah memakai PP 55
 *   meneruskannya sampai jendela aslinya habis (PT 3 tahun, CV/firma 4 tahun).
 * - Sesudahnya PPh badan normal 22%; omzet ≤ Rp50 M memakai fasilitas Pasal 31E
 *   (tarif separuh atas laba dari Rp4,8 M omzet pertama) → `NORMAL_31E`.
 * - `BELUM_DITETAPKAN` (bawaan): fitur yang bergantung pada rezim (PPh final
 *   bulanan, angsuran PPh 25) belum aktif dan layar mengingatkan pemilik.
 */

export const KUNCI_PROFIL_PAJAK = "pajak.profil";

export type BentukUsaha = "BELUM_DITETAPKAN" | "ORANG_PRIBADI" | "PT_PERORANGAN" | "CV" | "PT" | "KOPERASI";
export const SEMUA_BENTUK_USAHA: readonly BentukUsaha[] = [
  "BELUM_DITETAPKAN",
  "ORANG_PRIBADI",
  "PT_PERORANGAN",
  "CV",
  "PT",
  "KOPERASI",
];

export type RezimPph = "BELUM_DITETAPKAN" | "FINAL_UMKM" | "NORMAL_31E" | "NORMAL";
export const SEMUA_REZIM_PPH: readonly RezimPph[] = ["BELUM_DITETAPKAN", "FINAL_UMKM", "NORMAL_31E", "NORMAL"];

export type ProfilPajak = {
  bentukUsaha: BentukUsaha;
  rezimPph: RezimPph;
  /** "YYYY-MM-DD" (hari WIB) rezim ini berlaku, atau null. */
  sejak: string | null;
};

export const PROFIL_PAJAK_BAWAAN: Readonly<ProfilPajak> = Object.freeze({
  bentukUsaha: "BELUM_DITETAPKAN",
  rezimPph: "BELUM_DITETAPKAN",
  sejak: null,
});

export const LABEL_BENTUK_USAHA: Readonly<Record<BentukUsaha, string>> = {
  BELUM_DITETAPKAN: "Belum ditetapkan",
  ORANG_PRIBADI: "Orang pribadi",
  PT_PERORANGAN: "PT perorangan",
  CV: "CV",
  PT: "PT",
  KOPERASI: "Koperasi",
};

export const LABEL_REZIM_PPH: Readonly<Record<RezimPph, string>> = {
  BELUM_DITETAPKAN: "Belum ditetapkan",
  FINAL_UMKM: "PPh final UMKM 0,5% (PP 20/2026)",
  NORMAL_31E: "PPh badan 22% dengan fasilitas Pasal 31E",
  NORMAL: "PPh badan 22%",
};

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(v: unknown): string | null {
  if (typeof v !== "string" || !POLA_TANGGAL.test(v.trim())) return null;
  const t = v.trim();
  const d = new Date(`${t}T00:00:00.000+07:00`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) === t ? t : null;
}

/** Baca nilai tersimpan (teks JSON atau objek) dengan lunak: kunci tidak sah jatuh ke bawaan. */
export function bacaProfilPajakMentah(nilai: unknown): ProfilPajak {
  let v = nilai;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { ...PROFIL_PAJAK_BAWAAN };
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...PROFIL_PAJAK_BAWAAN };
  const o = v as Record<string, unknown>;
  return {
    bentukUsaha: SEMUA_BENTUK_USAHA.includes(o.bentukUsaha as BentukUsaha)
      ? (o.bentukUsaha as BentukUsaha)
      : PROFIL_PAJAK_BAWAAN.bentukUsaha,
    rezimPph: SEMUA_REZIM_PPH.includes(o.rezimPph as RezimPph) ? (o.rezimPph as RezimPph) : PROFIL_PAJAK_BAWAAN.rezimPph,
    sejak: tanggalSah(o.sejak),
  };
}

/** PPh final UMKM 0,5% dihitung bulanan dari omzet bruto buku besar? Hanya bila rezimnya ditetapkan FINAL_UMKM. */
export function pakaiPphFinalUmkm(profil: ProfilPajak): boolean {
  return profil.rezimPph === "FINAL_UMKM";
}

export type GalatProfilPajak = "BENTUK_TIDAK_SAH" | "REZIM_TIDAK_SAH" | "TANGGAL_TIDAK_SAH";

/** Pemeriksaan KETAT untuk menyimpan (Pengaturan → Pajak). `sejak` boleh kosong. */
export function periksaProfilPajak(input: unknown): { ok: true; profil: ProfilPajak } | { ok: false; galat: GalatProfilPajak } {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (!SEMUA_BENTUK_USAHA.includes(o.bentukUsaha as BentukUsaha)) return { ok: false, galat: "BENTUK_TIDAK_SAH" };
  if (!SEMUA_REZIM_PPH.includes(o.rezimPph as RezimPph)) return { ok: false, galat: "REZIM_TIDAK_SAH" };
  const kosong = o.sejak == null || o.sejak === "";
  const sejak = kosong ? null : tanggalSah(o.sejak);
  if (!kosong && !sejak) return { ok: false, galat: "TANGGAL_TIDAK_SAH" };
  return { ok: true, profil: { bentukUsaha: o.bentukUsaha as BentukUsaha, rezimPph: o.rezimPph as RezimPph, sejak } };
}

/**
 * Bentuk usaha yang boleh memakai PPh final UMKM menurut PP 20/2026. CV, firma
 * dan PT biasa hanya selama jendela PP 55/2022-nya masih berjalan — layar
 * memperingatkan, tidak menolak (pemilik yang tahu sejak kapan).
 */
export const BENTUK_USAHA_FINAL_UMKM: readonly BentukUsaha[] = ["ORANG_PRIBADI", "PT_PERORANGAN", "KOPERASI"];

export function finalUmkmPerluDicek(p: ProfilPajak): boolean {
  return p.rezimPph === "FINAL_UMKM" && !BENTUK_USAHA_FINAL_UMKM.includes(p.bentukUsaha);
}

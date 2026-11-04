/**
 * Ambang tier KOL (`SystemSetting["kreatif.tier"]`) — murni, aman untuk klien.
 *
 * Tier tidak disimpan per KOL; ia dihitung saat dibaca dari pengikut
 * terbanyak (`tierKol` di `aturan.ts`). Yang disimpan hanya batas bawah tiap
 * tingkat di atas nano. Baris kosong atau rusak jatuh ke bawaan di bawah ini,
 * yang diubah pemilik di Kreatif → Pengaturan.
 *
 * Bawaan = konsep "KOL Manager" pemilik (2026-10-10). Catatan: bawaan ini
 * MENGUBAH arti "makro" dari ≥ 100 rb menjadi ≥ 500 rb (100 rb–500 rb kini "mid").
 */

export const KUNCI_TIER = "kreatif.tier";

/** Batas bawah (inklusif) tiap tingkat; di bawah `mikro` = nano. */
export type AmbangTier = { mikro: number; mid: number; makro: number; mega: number };

export const AMBANG_TIER_BAWAAN: AmbangTier = { mikro: 10_000, mid: 100_000, makro: 500_000, mega: 1_000_000 };

/** Urutan naik — setiap batas harus lebih besar dari yang sebelumnya. */
export const DAFTAR_KUNCI_TIER = ["mikro", "mid", "makro", "mega"] as const satisfies readonly (keyof AmbangTier)[];

/** Batas atas wajar satu ambang (1 miliar pengikut). */
export const MAKS_AMBANG_TIER = 1_000_000_000;

export type SebabGalatTier = "BUKAN_ANGKA" | "TIDAK_NAIK";

export type GalatTier = { kunci: keyof AmbangTier; sebab: SebabGalatTier };

export type HasilValidasiTier = { ok: true; ambang: AmbangTier } | { ok: false; galat: GalatTier[] };

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

const angkaSah = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAKS_AMBANG_TIER;

/**
 * Validasi untuk penyimpanan: keempat batas WAJIB ada, bilangan bulat positif,
 * dan naik berurutan (sama dengan ditolak — dua tingkat dengan batas sama
 * membuat yang bawah tidak pernah terpakai).
 */
export function validasiAmbangTier(input: unknown): HasilValidasiTier {
  const o = keObjek(input);
  if (!o) return { ok: false, galat: DAFTAR_KUNCI_TIER.map((kunci) => ({ kunci, sebab: "BUKAN_ANGKA" as const })) };
  const galat: GalatTier[] = [];
  for (const k of DAFTAR_KUNCI_TIER) if (!angkaSah(o[k])) galat.push({ kunci: k, sebab: "BUKAN_ANGKA" });
  if (galat.length) return { ok: false, galat };
  const ambang = Object.fromEntries(DAFTAR_KUNCI_TIER.map((k) => [k, o[k] as number])) as AmbangTier;
  for (let i = 1; i < DAFTAR_KUNCI_TIER.length; i++) {
    const k = DAFTAR_KUNCI_TIER[i];
    if (ambang[k] <= ambang[DAFTAR_KUNCI_TIER[i - 1]]) galat.push({ kunci: k, sebab: "TIDAK_NAIK" });
  }
  return galat.length ? { ok: false, galat } : { ok: true, ambang };
}

/**
 * Pembaca pemaaf. Berbeda dengan ambang hari, isi yang tidak sah jatuh ke
 * bawaan SELURUHNYA — mencampur satu angka simpanan dengan bawaan bisa
 * menghasilkan urutan yang tidak naik.
 */
export function bacaAmbangTier(nilai: unknown): AmbangTier {
  const v = validasiAmbangTier(nilai);
  return v.ok ? v.ambang : { ...AMBANG_TIER_BAWAAN };
}

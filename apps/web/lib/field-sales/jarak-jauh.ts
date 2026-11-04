/**
 * Pesanan jarak jauh — toko memesan lewat WhatsApp/telepon, salesman mencatatnya
 * tanpa kunjungan (tanpa check-in). Murni: dipakai penulis pesanan, halaman
 * katalog, dan kartu pengaturan.
 *
 * Aturan pemilik di `SystemSetting["salesman.pesananJarakJauh"]` (JSON):
 * - `aktif` (bawaan: ya) — boleh tidaknya pesanan jarak jauh sama sekali.
 * - `hanyaTokoSendiri` (bawaan: ya) — hanya untuk toko yang DIPEGANG salesman itu
 *   (`Store.salesmanId`). Tanpa kunjungan tidak ada bukti ia berurusan dengan toko
 *   itu; kepemilikan toko adalah penggantinya.
 */

export const SALURAN_JARAK_JAUH = ["WA", "TELEPON", "LAINNYA"] as const;
export type SaluranJarakJauh = (typeof SALURAN_JARAK_JAUH)[number];

export function bacaSaluran(x: unknown): SaluranJarakJauh | null {
  const v = Array.isArray(x) ? x[0] : x;
  return typeof v === "string" && (SALURAN_JARAK_JAUH as readonly string[]).includes(v) ? (v as SaluranJarakJauh) : null;
}

/**
 * Semua nilai yang bisa tercatat di `FieldSalesOrder.remoteChannel`: tiga
 * saluran yang dipilih salesman, ditambah `PORTAL` — toko memesan sendiri
 * lewat tautan portal. `PORTAL` sengaja TIDAK ada di `SALURAN_JARAK_JAUH`:
 * salesman tidak pernah memilihnya, dan aturan WA/telepon tidak berlaku untuknya.
 */
export const SALURAN_PORTAL = "PORTAL" as const;
export type SaluranPesanan = SaluranJarakJauh | typeof SALURAN_PORTAL;

export function bacaSaluranPesanan(x: unknown): SaluranPesanan | null {
  const v = Array.isArray(x) ? x[0] : x;
  return v === SALURAN_PORTAL ? SALURAN_PORTAL : bacaSaluran(v);
}

export const KUNCI_JARAK_JAUH = "salesman.pesananJarakJauh";

export type AturanJarakJauh = { aktif: boolean; hanyaTokoSendiri: boolean };

export const ATURAN_JARAK_JAUH_BAWAAN: AturanJarakJauh = { aktif: true, hanyaTokoSendiri: true };

/** JSON tersimpan → aturan. Kolom yang hilang atau rusak jatuh ke bawaannya masing-masing. */
export function bacaAturanJarakJauh(raw: string | null | undefined): AturanJarakJauh {
  if (!raw) return { ...ATURAN_JARAK_JAUH_BAWAAN };
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return { ...ATURAN_JARAK_JAUH_BAWAAN };
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ...ATURAN_JARAK_JAUH_BAWAAN };
  const o = x as Record<string, unknown>;
  return {
    aktif: typeof o.aktif === "boolean" ? o.aktif : ATURAN_JARAK_JAUH_BAWAAN.aktif,
    hanyaTokoSendiri: typeof o.hanyaTokoSendiri === "boolean" ? o.hanyaTokoSendiri : ATURAN_JARAK_JAUH_BAWAAN.hanyaTokoSendiri,
  };
}

export type PenolakanJarakJauh = "JARAK_JAUH_NONAKTIF" | "BUKAN_TOKO_SENDIRI";

/** null = boleh. Toko tanpa pemegang bukan "toko sendiri" siapa pun. */
export function periksaJarakJauh(
  aturan: AturanJarakJauh,
  p: { salesmanId: string; pemegangToko: string | null },
): PenolakanJarakJauh | null {
  if (!aturan.aktif) return "JARAK_JAUH_NONAKTIF";
  if (aturan.hanyaTokoSendiri && p.pemegangToko !== p.salesmanId) return "BUKAN_TOKO_SENDIRI";
  return null;
}

export class JarakJauhDitolakError extends Error {
  constructor(public code: PenolakanJarakJauh) {
    super(code);
    this.name = "JarakJauhDitolakError";
  }
}

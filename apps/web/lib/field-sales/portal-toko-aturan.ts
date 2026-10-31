/**
 * Portal pesan mandiri toko — bagian MURNI: aturan pemilik, pemeriksaan tautan,
 * dan ember ketersediaan. Aman dibundel ke klien (kartu pengaturan, layar
 * portal); tidak menyentuh Prisma maupun `node:crypto`. Bagian yang menyentuh
 * basis data dan pembuatan token ada di `portal-toko.ts`.
 *
 * Aturan pemilik di `SystemSetting["salesman.portalToko"]` (JSON):
 * - `aktif` (bawaan: ya) — mematikannya membuat SEMUA tautan portal mati
 *   seketika, tanpa perlu mencabut satu per satu.
 * - `masaBerlakuHari` (bawaan: 90) — masa berlaku tautan baru.
 * - `maksPesananPerHari` (bawaan: 5) — pesanan portal per toko per hari (WIB).
 *   Penjaga terhadap tautan yang bocor: orang yang memegang tautan tidak bisa
 *   membanjiri kantor dengan pesanan, atau mengunci stok lewat cadangan.
 */

export const KUNCI_PORTAL_TOKO = "salesman.portalToko";

export type AturanPortalToko = { aktif: boolean; masaBerlakuHari: number; maksPesananPerHari: number };

export const ATURAN_PORTAL_BAWAAN: AturanPortalToko = { aktif: true, masaBerlakuHari: 90, maksPesananPerHari: 5 };

/** Batas yang boleh diisi pemilik. Tautan tanpa batas waktu sengaja tidak ditawarkan. */
export const BATAS_MASA_BERLAKU = { min: 1, maks: 365 } as const;
export const BATAS_PESANAN_PER_HARI = { min: 1, maks: 50 } as const;

/** Tautan aktif per toko. Lebih dari ini hampir pasti tautan lama yang lupa dicabut. */
export const MAKS_TAUTAN_AKTIF = 10;

const bulatDalam = (x: unknown, b: { min: number; maks: number }): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= b.min && x <= b.maks ? x : null;

/** JSON tersimpan → aturan. Kolom yang hilang, rusak, atau di luar batas jatuh ke bawaannya masing-masing. */
export function bacaAturanPortalToko(raw: string | null | undefined): AturanPortalToko {
  if (!raw) return { ...ATURAN_PORTAL_BAWAAN };
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return { ...ATURAN_PORTAL_BAWAAN };
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ...ATURAN_PORTAL_BAWAAN };
  const o = x as Record<string, unknown>;
  return {
    aktif: typeof o.aktif === "boolean" ? o.aktif : ATURAN_PORTAL_BAWAAN.aktif,
    masaBerlakuHari: bulatDalam(o.masaBerlakuHari, BATAS_MASA_BERLAKU) ?? ATURAN_PORTAL_BAWAAN.masaBerlakuHari,
    maksPesananPerHari: bulatDalam(o.maksPesananPerHari, BATAS_PESANAN_PER_HARI) ?? ATURAN_PORTAL_BAWAAN.maksPesananPerHari,
  };
}

/** Masukan formulir pengaturan → aturan yang sah, atau null. Nilai di luar batas DITOLAK, tidak dipotong diam-diam. */
export function sahkanAturanPortalToko(x: unknown): AturanPortalToko | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.aktif !== "boolean") return null;
  const masa = bulatDalam(o.masaBerlakuHari, BATAS_MASA_BERLAKU);
  const maks = bulatDalam(o.maksPesananPerHari, BATAS_PESANAN_PER_HARI);
  if (masa === null || maks === null) return null;
  return { aktif: o.aktif, masaBerlakuHari: masa, maksPesananPerHari: maks };
}

// ── Token ─────────────────────────────────────────────────────────────────

/** 32 bita acak dalam base64url tanpa padding = tepat 43 karakter. */
export const PANJANG_TOKEN = 43;

/**
 * Bentuk token yang mungkin sah. Diperiksa SEBELUM apa pun dihitung atau
 * dicari: masukan sembarang (sangat panjang, berisi garis miring) ditolak di
 * pintu, bukan di-hash lalu dicari.
 */
export function bentukTokenSah(token: unknown): token is string {
  return typeof token === "string" && token.length === PANJANG_TOKEN && /^[A-Za-z0-9_-]+$/.test(token);
}

// ── Pemeriksaan tautan ───────────────────────────────────────────────────

/**
 * Alasan sebuah tautan tidak bisa dipakai. Dibedakan di sini (untuk kantor,
 * log, dan tes), tetapi layar toko menampilkan SATU pesan yang sama untuk
 * semuanya — orang yang memegang tautan tidak perlu tahu kenapa.
 */
export type PenolakanTautan =
  | "PORTAL_NONAKTIF"
  | "TIDAK_DIKENAL"
  | "DICABUT"
  | "KEDALUWARSA"
  | "TOKO_NONAKTIF"
  | "TANPA_PEMEGANG";

export type BentukTautan = { revokedAt: Date | null; expiresAt: Date | null };
export type BentukTokoTautan = { isActive: boolean; salesmanId: string | null };

/**
 * null = tautan boleh dipakai. Urutannya disengaja: portal yang dimatikan
 * pemilik menang atas segalanya, lalu keadaan tautan, lalu keadaan toko.
 * Toko tanpa pemegang ditolak karena pesanan portal dicatat atas nama
 * pemegangnya — tanpa pemegang tidak ada yang bertanggung jawab atasnya.
 */
export function periksaTautan(p: {
  aturan: AturanPortalToko;
  tautan: BentukTautan | null;
  toko: BentukTokoTautan | null;
  sekarang: Date;
}): PenolakanTautan | null {
  if (!p.aturan.aktif) return "PORTAL_NONAKTIF";
  if (!p.tautan) return "TIDAK_DIKENAL";
  if (p.tautan.revokedAt) return "DICABUT";
  if (p.tautan.expiresAt && p.tautan.expiresAt.getTime() <= p.sekarang.getTime()) return "KEDALUWARSA";
  if (!p.toko) return "TIDAK_DIKENAL";
  if (!p.toko.isActive) return "TOKO_NONAKTIF";
  if (!p.toko.salesmanId) return "TANPA_PEMEGANG";
  return null;
}

export type KeadaanTautan = "AKTIF" | "KEDALUWARSA" | "DICABUT";

/** Keadaan tautan di daftar kantor/HP. Dicabut menang atas kedaluwarsa. */
export function keadaanTautan(t: BentukTautan, sekarang: Date): KeadaanTautan {
  if (t.revokedAt) return "DICABUT";
  if (t.expiresAt && t.expiresAt.getTime() <= sekarang.getTime()) return "KEDALUWARSA";
  return "AKTIF";
}

const HARI_MS = 86_400_000;

/** Kedaluwarsa tautan baru: `hari` × 24 jam dari sekarang. */
export function masaBerlakuDari(sekarang: Date, hari: number): Date {
  return new Date(sekarang.getTime() + hari * HARI_MS);
}

// ── Ketersediaan ─────────────────────────────────────────────────────────

/**
 * Toko hanya melihat EMBER, tidak pernah angka stok. Angka stok adalah urusan
 * kantor; tautan bisa diteruskan ke siapa saja, termasuk pesaing.
 */
export type Ketersediaan = "TERSEDIA" | "TERBATAS" | "HABIS";

/** Di bawah angka ini stok disebut "Terbatas". */
export const BATAS_TERBATAS = 12;

export function emberKetersediaan(tersedia: number): Ketersediaan {
  if (!Number.isFinite(tersedia) || tersedia <= 0) return "HABIS";
  if (tersedia < BATAS_TERBATAS) return "TERBATAS";
  return "TERSEDIA";
}

/** Ember satu barang dari ember variannya: yang terbaik menang (ada yang tersedia → "Tersedia"). */
export function emberBarang(ember: Ketersediaan[]): Ketersediaan {
  if (ember.includes("TERSEDIA")) return "TERSEDIA";
  if (ember.includes("TERBATAS")) return "TERBATAS";
  return "HABIS";
}

/**
 * Portal menawarkan stok PER KELIPATAN ini (dibulatkan ke bawah). Tanpanya,
 * pemegang tautan bisa menebak stok persis: pesan 50 → ditolak, 25 → diterima,
 * dan seterusnya (pencarian biner, ±14 percobaan per barang). Dengan kelipatan
 * 6, jawabannya sama untuk 36–41 pcs. Akibatnya sisa di bawah satu kelipatan
 * tidak bisa dipesan lewat portal — lewat salesman tetap bisa. Keputusan
 * sementara (2026-10-06, usulan Claude); 1 = tanpa pembulatan.
 */
export const KELIPATAN_STOK_PORTAL = 6;

/** Jumlah terbanyak yang boleh dipesan lewat portal untuk stok tersedia ini. */
export function batasPesanPortal(tersedia: number): number {
  if (!Number.isFinite(tersedia) || tersedia <= 0) return 0;
  return Math.floor(tersedia / KELIPATAN_STOK_PORTAL) * KELIPATAN_STOK_PORTAL;
}

/** Ember yang dilihat toko: dari apa yang BISA dipesan lewat portal, bukan stok mentah. */
export function emberPortal(tersedia: number): Ketersediaan {
  return emberKetersediaan(batasPesanPortal(tersedia));
}

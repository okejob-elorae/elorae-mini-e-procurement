import { bacaRupiahSen } from "./aturan";

/**
 * Kas kecil (dana tetap / imprest) — MURNI, aman untuk klien.
 *
 * Setiap dana kas kecil adalah satu akun kas (ASET daun, terdaftar sebagai
 * rekening kas/bank) dengan DANA TETAP. Pengeluaran dari kas kecil dicatat
 * sebagai voucher keluar (BKK) dengan rekening = akun kas kecil itu. "Isi ulang"
 * membuat SATU voucher TRANSFER dari rekening sumber ke kas kecil sebesar dana
 * tetap − saldo buku saat ini, jadi sesudahnya saldo kembali ke dana tetap.
 *
 * Disimpan di `SystemSetting["finance.kasKecil"]` = `{ dana: [{ akunId,
 * danaTetap, pemegang, rekeningSumberId }] }`. Tanpa baris = belum ada kas kecil.
 */

export const KUNCI_KAS_KECIL = "finance.kasKecil";
export const MAKS_DANA_KAS_KECIL = 20;

export type DanaKasKecil = {
  akunId: string;
  /** Rupiah. */
  danaTetap: number;
  pemegang: string | null;
  /** Rekening bawaan untuk isi ulang (boleh null — dipilih saat mengisi ulang). */
  rekeningSumberId: string | null;
};

export type PengaturanKasKecil = { dana: DanaKasKecil[] };

export const KAS_KECIL_KOSONG: PengaturanKasKecil = { dana: [] };

/** Baca longgar: baris rusak dibuang, tidak pernah melempar. */
export function bacaPengaturanKasKecil(json: unknown): PengaturanKasKecil {
  let o: unknown = json;
  if (typeof json === "string") {
    try {
      o = JSON.parse(json);
    } catch {
      return KAS_KECIL_KOSONG;
    }
  }
  if (!o || typeof o !== "object" || !Array.isArray((o as { dana?: unknown }).dana)) return KAS_KECIL_KOSONG;
  const dana: DanaKasKecil[] = [];
  const dilihat = new Set<string>();
  for (const d of (o as { dana: unknown[] }).dana) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (typeof r.akunId !== "string" || !r.akunId || dilihat.has(r.akunId)) continue;
    const sen = bacaRupiahSen(r.danaTetap);
    if (sen == null || sen <= 0) continue;
    dilihat.add(r.akunId);
    dana.push({
      akunId: r.akunId,
      danaTetap: sen / 100,
      pemegang: typeof r.pemegang === "string" && r.pemegang.trim() ? r.pemegang.trim().slice(0, 100) : null,
      rekeningSumberId: typeof r.rekeningSumberId === "string" && r.rekeningSumberId ? r.rekeningSumberId : null,
    });
  }
  return { dana };
}

export type KodeGalatKasKecil =
  | "DANA_TIDAK_SAH"
  | "AKUN_GANDA"
  | "TERLALU_BANYAK"
  | "AKUN_BUKAN_KAS"
  | "SUMBER_BUKAN_KAS"
  | "SUMBER_SAMA";

/**
 * Periksa ketat isian pengaturan (untuk menyimpan). `rekeningKas` = id akun
 * kas/bank yang sah; akun dana dan rekening sumber wajib di antaranya, dan
 * keduanya tidak boleh sama.
 */
export function periksaPengaturanKasKecil(
  input: unknown,
  rekeningKas: ReadonlySet<string>,
): { ok: true; pengaturan: PengaturanKasKecil } | { ok: false; kode: KodeGalatKasKecil; baris?: number } {
  const daftar = input && typeof input === "object" ? (input as { dana?: unknown }).dana : null;
  if (!Array.isArray(daftar)) return { ok: false, kode: "DANA_TIDAK_SAH" };
  if (daftar.length > MAKS_DANA_KAS_KECIL) return { ok: false, kode: "TERLALU_BANYAK" };
  const dana: DanaKasKecil[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < daftar.length; i++) {
    const r = (daftar[i] ?? {}) as Record<string, unknown>;
    const akunId = typeof r.akunId === "string" ? r.akunId : "";
    if (!akunId || !rekeningKas.has(akunId)) return { ok: false, kode: "AKUN_BUKAN_KAS", baris: i + 1 };
    if (dilihat.has(akunId)) return { ok: false, kode: "AKUN_GANDA", baris: i + 1 };
    dilihat.add(akunId);
    const sen = bacaRupiahSen(r.danaTetap);
    if (sen == null || sen <= 0) return { ok: false, kode: "DANA_TIDAK_SAH", baris: i + 1 };
    const sumber = typeof r.rekeningSumberId === "string" && r.rekeningSumberId ? r.rekeningSumberId : null;
    if (sumber && !rekeningKas.has(sumber)) return { ok: false, kode: "SUMBER_BUKAN_KAS", baris: i + 1 };
    if (sumber === akunId) return { ok: false, kode: "SUMBER_SAMA", baris: i + 1 };
    dana.push({
      akunId,
      danaTetap: sen / 100,
      pemegang: typeof r.pemegang === "string" && r.pemegang.trim() ? r.pemegang.trim().slice(0, 100) : null,
      rekeningSumberId: sumber,
    });
  }
  return { ok: true, pengaturan: { dana } };
}

/**
 * Jumlah isi ulang = dana tetap − saldo buku (dalam sen, tidak pernah
 * negatif). Saldo di atas dana tetap (mis. ada setoran sisa) → 0: tidak ada
 * yang perlu diisi.
 */
export function hitungIsiUlangSen(danaTetap: number, saldo: number): number {
  const selisih = Math.round(danaTetap * 100) - Math.round(saldo * 100);
  return selisih > 0 ? selisih : 0;
}

/** Bagian dana tetap yang sudah terpakai, 0–100 (untuk batang kemajuan). */
export function persenTerpakai(danaTetap: number, saldo: number): number {
  if (danaTetap <= 0) return 0;
  const p = ((danaTetap - saldo) / danaTetap) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

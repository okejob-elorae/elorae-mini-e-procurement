import { kunciHariWib } from "@/lib/dashboard/tren";
import { barangBaru, MIN_PCS_LARIS, type BarangTersedia, type JualSejenis } from "@/lib/salesman/saran-tawar";
import type { StatusPermintaan } from "./kantor-queries";

/**
 * Permintaan barang SPG ke salesman/kantor: alasan per baris, alamat
 * "tambahkan ke formulir", dan saran "yang perlu diminta". Murni — aman untuk
 * komponen klien (tidak menarik Prisma). Kuerinya di `saran-minta-queries.ts`.
 */

const HARI_MS = 86_400_000;

// ─── Alasan per baris permintaan (`StockRequestLine.alasan`) ──────────────────

/**
 * Lima nilai yang sama dengan `StoreRecommendationLine.alasan`:
 *   LAKU_DI_TOKO_LAIN — laku di toko lain se-area / sejenis, tipis di sini;
 *   SERING_DIKIRIM    — sering dikirim ke toko ini dan sisanya menipis;
 *   BARANG_BARU       — barang baru yang belum pernah ada di toko ini;
 *   LAKU_DI_SINI      — dari analisa toko sendiri (hampir habis, dicari pembeli);
 *   MANUAL            — dipilih sendiri dari pencarian.
 * Dua lagi khusus permintaan SPG (kolomnya string bebas, rekomendasi tidak memakainya):
 *   DICARI_PEMBELI    — dari catatan "barang dicari" (`LostSale`);
 *   TITIP_PEMBELI     — dari "titip pesan" pembeli yang menunggu barangnya (`CustomerRequest`).
 */
export const ALASAN_PERMINTAAN = [
  "LAKU_DI_TOKO_LAIN",
  "SERING_DIKIRIM",
  "BARANG_BARU",
  "LAKU_DI_SINI",
  "MANUAL",
  "DICARI_PEMBELI",
  "TITIP_PEMBELI",
] as const;
export type AlasanPermintaan = (typeof ALASAN_PERMINTAAN)[number];

/** Tiga kelompok saran di formulir minta kiriman, urut tampil. */
export const ALASAN_SARAN = ["LAKU_DI_TOKO_LAIN", "SERING_DIKIRIM", "BARANG_BARU"] as const;
export type AlasanSaran = (typeof ALASAN_SARAN)[number];

export function bacaAlasan(x: unknown): AlasanPermintaan | null {
  return typeof x === "string" && (ALASAN_PERMINTAAN as readonly string[]).includes(x) ? (x as AlasanPermintaan) : null;
}

// ─── Alamat "tambahkan ke formulir minta kiriman" ─────────────────────────────

/** Paling banyak baris yang dibawa satu alamat — alamat panjang dipotong sebagian peramban. */
export const BATAS_TAMBAHAN = 50;
export const QTY_TAMBAHAN_MAKS = 10_000;
const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type BarisTambahan = { itemId: string; variantSku: string; qty: number; alasan: AlasanPermintaan };

/**
 * Nilai `?tambah=` untuk `/pwa/spg/stok/minta`: baris `alasan~itemId~varian~qty`
 * dipisah koma, setiap bagian di-encode (SKU varian bisa memuat tanda apa pun).
 */
export function tulisTambahan(baris: readonly BarisTambahan[]): string {
  // `encodeURIComponent` membiarkan "~" apa adanya — padahal itu pemisahnya.
  const kode = (x: string) => encodeURIComponent(x).replace(/~/g, "%7E");
  return baris
    .slice(0, BATAS_TAMBAHAN)
    .map((b) => [b.alasan, b.itemId, b.variantSku ?? "", String(b.qty)].map(kode).join("~"))
    .join(",");
}

/** Alamat formulir minta kiriman yang langsung membawa baris-baris ini. */
export function alamatMinta(baris: readonly BarisTambahan[]): string {
  if (baris.length === 0) return "/pwa/spg/stok/minta";
  return `/pwa/spg/stok/minta?${new URLSearchParams({ tambah: tulisTambahan(baris) }).toString()}`;
}

/**
 * Kebalikan `tulisTambahan`. Alamat bisa dibuat siapa saja, jadi setiap bagian
 * diperiksa; baris yang rusak dibuang diam-diam (bukan seluruh alamat), baris
 * ganda digabung jumlahnya.
 */
export function bacaTambahan(raw: unknown): BarisTambahan[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string" || s.length === 0 || s.length > 20_000) return [];
  const hasil = new Map<string, BarisTambahan>();
  for (const bagian of s.split(",")) {
    if (hasil.size >= BATAS_TAMBAHAN) break;
    const p = bagian.split("~");
    if (p.length !== 4) continue;
    let alasanMentah: string, itemId: string, variantSku: string, qtyTeks: string;
    try {
      [alasanMentah, itemId, variantSku, qtyTeks] = p.map(decodeURIComponent);
    } catch {
      continue;
    }
    const alasan = bacaAlasan(alasanMentah);
    const qty = /^\d{1,5}$/.test(qtyTeks) ? Number(qtyTeks) : NaN;
    if (!alasan || !POLA_ID.test(itemId) || variantSku.length > 100 || !Number.isInteger(qty) || qty < 1 || qty > QTY_TAMBAHAN_MAKS) continue;
    const kunci = `${itemId}::${variantSku}`;
    const ada = hasil.get(kunci);
    if (ada) ada.qty = Math.min(QTY_TAMBAHAN_MAKS, ada.qty + qty);
    else hasil.set(kunci, { itemId, variantSku, qty, alasan });
  }
  return [...hasil.values()];
}

// ─── Saran untuk diminta ──────────────────────────────────────────────────────

/** Jendela "sering dikirim" — sama dengan barang favorit di ringkasan toko salesman. */
export const HARI_SERING = 180;
/** "Sering" = paling sedikit dua kali dikirim dalam jendela itu. */
export const MIN_KALI_SERING = 2;
/** Sisa di rak sebanyak ini atau kurang dianggap tipis (sama dengan "hampir habis" di stok SPG). */
export const BATAS_TIPIS = 2;
/**
 * Barang yang biasa dikirim dalam jumlah besar sudah tipis sebelum sisa 2: sisa
 * di bawah seperempat kiriman rata-ratanya juga dihitung tipis.
 */
export const PORSI_TIPIS = 0.25;
export const BATAS_SARAN_MINTA = 10;

/** Satu kiriman/pesanan satu barang ke toko ini. */
export type KirimanToko = { itemId: string; tanggal: Date; pcs: number };

export type BahanSaranMinta = {
  /** Laku di toko pembanding (`jualTokoSejenis`) — tanpa nama toko, tanpa rupiah. */
  jualSejenis: readonly JualSejenis[];
  /** Kiriman ke toko ini (pesanan lapangan, jual van, kiriman konsinyasi). */
  kiriman: readonly KirimanToko[];
  /** Sisa di rak per barang (Σ varian yang positif); null = toko belum punya buku stok. */
  saldo: ReadonlyMap<string, number> | null;
  /** Barang yang pernah bergerak di buku stok toko ini. */
  pernahDiBuku: ReadonlySet<string>;
  /** Stok tersedia gudang (on hand − dipesan) dan tanggal dibuat. */
  barang: readonly BarangTersedia[];
  hariBaru: number;
};

export type SaranMinta =
  | { alasan: "LAKU_DI_TOKO_LAIN"; itemId: string; pcs: number; toko: number; sisa: number | null }
  | { alasan: "SERING_DIKIRIM"; itemId: string; kali: number; pcs: number; sisa: number | null; hariSejak: number }
  | { alasan: "BARANG_BARU"; itemId: string; umurHari: number };

const hariSejak = (tanggal: Date, hariIni: Date) =>
  Math.max(0, Math.round((Date.parse(`${kunciHariWib(hariIni)}T00:00:00Z`) - Date.parse(`${kunciHariWib(tanggal)}T00:00:00Z`)) / HARI_MS));

/**
 * Tiga kelompok saran, satu barang satu alasan. Prioritasnya: kebiasaan toko
 * ini sendiri (SERING_DIKIRIM) mengalahkan laku di toko lain, dan keduanya
 * mengalahkan barang baru — sama dengan urutan alasan saran tawar salesman.
 *
 * Barang yang stok gudangnya habis TIDAK PERNAH disarankan: meminta barang yang
 * tidak bisa dikirim hanya membuat permintaan yang pasti ditolak.
 */
export function susunSaranMinta(bahan: BahanSaranMinta, hariIni: Date): Record<AlasanSaran, SaranMinta[]> {
  const tersedia = new Set(bahan.barang.filter((b) => b.tersedia > 0).map((b) => b.itemId));
  const sisaDi = (itemId: string) => (bahan.saldo ? (bahan.saldo.get(itemId) ?? 0) : null);
  const pernahDikirim = new Set(bahan.kiriman.map((k) => k.itemId));
  const sudah = new Set<string>();

  // SERING_DIKIRIM
  const batasSering = hariIni.getTime() - HARI_SERING * HARI_MS;
  const per = new Map<string, { kali: number; pcs: number; terakhir: Date }>();
  for (const k of bahan.kiriman) {
    if (k.tanggal.getTime() < batasSering || k.pcs <= 0) continue;
    const ada = per.get(k.itemId);
    if (!ada) per.set(k.itemId, { kali: 1, pcs: k.pcs, terakhir: k.tanggal });
    else {
      ada.kali += 1;
      ada.pcs += k.pcs;
      if (k.tanggal > ada.terakhir) ada.terakhir = k.tanggal;
    }
  }
  const sering: Extract<SaranMinta, { alasan: "SERING_DIKIRIM" }>[] = [];
  for (const [itemId, s] of per) {
    if (s.kali < MIN_KALI_SERING || !tersedia.has(itemId)) continue;
    const sisa = sisaDi(itemId);
    // Tanpa buku stok sisanya tidak diketahui — sarannya tetap muncul, layarnya menyebut itu.
    if (sisa !== null && sisa > Math.max(BATAS_TIPIS, Math.floor((s.pcs / s.kali) * PORSI_TIPIS))) continue;
    sering.push({ alasan: "SERING_DIKIRIM", itemId, kali: s.kali, pcs: s.pcs, sisa, hariSejak: hariSejak(s.terakhir, hariIni) });
  }
  sering.sort((a, b) => b.kali - a.kali || b.pcs - a.pcs || a.itemId.localeCompare(b.itemId));
  const hasilSering = sering.slice(0, BATAS_SARAN_MINTA);
  for (const s of hasilSering) sudah.add(s.itemId);

  // LAKU_DI_TOKO_LAIN — laku di toko pembanding, belum ada / tipis di sini.
  const laris: Extract<SaranMinta, { alasan: "LAKU_DI_TOKO_LAIN" }>[] = [];
  for (const j of bahan.jualSejenis) {
    if (sudah.has(j.itemId) || !tersedia.has(j.itemId) || j.pcs < MIN_PCS_LARIS) continue;
    const sisa = sisaDi(j.itemId);
    if (sisa === null ? pernahDikirim.has(j.itemId) : sisa > BATAS_TIPIS) continue;
    laris.push({ alasan: "LAKU_DI_TOKO_LAIN", itemId: j.itemId, pcs: j.pcs, toko: j.toko, sisa });
  }
  laris.sort((a, b) => b.pcs - a.pcs || b.toko - a.toko || a.itemId.localeCompare(b.itemId));
  const hasilLaris = laris.slice(0, BATAS_SARAN_MINTA);
  for (const l of hasilLaris) sudah.add(l.itemId);

  // BARANG_BARU — belum pernah ada di toko ini (tidak pernah dikirim, tidak pernah di buku).
  const baru: Extract<SaranMinta, { alasan: "BARANG_BARU" }>[] = barangBaru(bahan.barang, hariIni, bahan.hariBaru)
    .filter((b) => !sudah.has(b.itemId) && !pernahDikirim.has(b.itemId) && !bahan.pernahDiBuku.has(b.itemId))
    .slice(0, BATAS_SARAN_MINTA)
    .map((b) => ({ alasan: "BARANG_BARU", itemId: b.itemId, umurHari: b.umurHari }));

  return { LAKU_DI_TOKO_LAIN: hasilLaris, SERING_DIKIRIM: hasilSering, BARANG_BARU: baru };
}

/** Urutan tab status di kotak masuk salesman. Di sini (bukan di kueri) supaya layar klien bisa memakainya. */
export const STATUS_PERMINTAAN: readonly StatusPermintaan[] = ["BARU", "DIPROSES", "SELESAI", "DITOLAK"];

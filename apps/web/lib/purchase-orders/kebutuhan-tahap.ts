import { bagiRata, bulat2, keSen } from "./rincian-warna";

/*
 * PO dari tahap produksi (2026-10-07, meniru "Buat PO Kain" + kalkulator 3 arah
 * PLAN PRODUKSI SSG). Murni, aman di klien.
 *
 * Kebutuhan tiap bahan TIDAK dihitung di sini: angkanya datang dari
 * `ruangKerjaTahap` (lib/production/jadwal-queries.ts) — aturan konsumsi ×
 * qty tahap × (1 + susut%), dua desimal — yang juga mengisi kartu Kebutuhan
 * bahan di ruang kerja tahap. Satu rumus, jadi kekurangan di kartu = qty yang
 * terisi di formulir PO.
 */

/** Satu bahan tahap, seperti kartu Kebutuhan bahan; `diPo` = PO tahap ini yang sudah ada (tidak batal). */
export type BahanTahap = {
  itemId: string;
  nama: string;
  sku: string;
  satuan: string;
  perPcs: number;
  wastePercent: number;
  butuh: number;
  diPo: number;
};

/** Data panel "Kebutuhan vs tahap" di formulir PO baru. */
export type KebutuhanTahapPo = {
  tahapId: string;
  targetQty: number;
  bahan: BahanTahap[];
};

/** Kekurangan bahan = kebutuhan − yang sudah di-PO, tidak pernah di bawah nol. */
export function kekurangan(butuh: number, diPo: number): number {
  return Math.max(0, keSen(butuh) - keSen(diPo)) / 100;
}

/** Baris isian PO dari kekurangan: bahan yang masih kurang, urut seperti di kartu. */
export function susunIsiKurang(
  bahan: readonly Pick<BahanTahap, "itemId" | "butuh" | "diPo">[],
  pilih?: readonly string[] | null,
): { itemId: string; qty: number }[] {
  const saring = pilih && pilih.length > 0 ? new Set(pilih) : null;
  const hasil: { itemId: string; qty: number }[] = [];
  for (const b of bahan) {
    if (saring && !saring.has(b.itemId)) continue;
    const qty = kekurangan(b.butuh, b.diPo);
    if (qty > 0) hasil.push({ itemId: b.itemId, qty });
  }
  return hasil;
}

/** "Produksi <tahap> · <jenis>" — catatan PO yang dibuat dari tahap. */
export function catatanProduksi(namaTahap: string, jenis: { code: string; name: string }): string {
  const j = jenis.name.trim() || jenis.code.trim();
  const t = namaTahap.trim();
  return j ? `Produksi ${t} · ${j}` : `Produksi ${t}`;
}

// ─── Kalkulator 3 arah: konsumsi/pcs ↔ qty dipesan ↔ hasil pcs ─────────────

/** Bahan per satu pcs jadi, susut ikut: konsumsi × (1 + susut%). */
export function pemakaianPerPcs(konsumsi: number, wastePercent: number): number {
  return konsumsi * (1 + (wastePercent || 0) / 100);
}

/** Hasil pcs dari qty bahan: qty ÷ (konsumsi × (1 + susut%)), dua desimal. Null bila konsumsi 0. */
export function hasilDariQty(qty: number, konsumsi: number, wastePercent: number): number | null {
  const per = pemakaianPerPcs(konsumsi, wastePercent);
  if (!(per > 0)) return null;
  return bulat2(qty / per);
}

/** Qty bahan untuk sekian pcs: pcs × konsumsi × (1 + susut%), dua desimal. */
export function qtyDariHasil(pcs: number, konsumsi: number, wastePercent: number): number {
  return bulat2(pcs * pemakaianPerPcs(konsumsi, wastePercent));
}

export type KeadaanTahap = { keadaan: "PAS" | "LEBIH" | "KURANG"; pcs: number };

/**
 * Qty PO ini + PO tahap lain dibandingkan dengan kebutuhan qty tahap, dalam
 * pcs. Kebutuhan = qty tahap × konsumsi × (1 + susut%), dua desimal — rumus
 * yang sama dengan kartu Kebutuhan bahan, jadi mengisi persis kekurangannya
 * selalu "pas". Lebih kurang dari satu pcs dihitung pas (sisa potong); kurang
 * sedikit pun dihitung kurang satu pcs, karena pcs terakhir tidak jadi.
 */
export function keadaanTerhadapTahap(masukan: {
  qty: number;
  diPoLain: number;
  konsumsi: number;
  wastePercent: number;
  targetQty: number;
}): KeadaanTahap | null {
  const per = pemakaianPerPcs(masukan.konsumsi, masukan.wastePercent);
  if (!(per > 0) || !(masukan.targetQty > 0)) return null;
  const butuh = keSen(masukan.targetQty * per);
  const ada = keSen(masukan.qty) + keSen(masukan.diPoLain);
  const selisih = (ada - butuh) / 100;
  if (selisih === 0) return { keadaan: "PAS", pcs: 0 };
  if (selisih > 0) {
    const pcs = Math.floor(selisih / per + 1e-9);
    return pcs === 0 ? { keadaan: "PAS", pcs: 0 } : { keadaan: "LEBIH", pcs };
  }
  return { keadaan: "KURANG", pcs: Math.max(1, Math.ceil(-selisih / per - 1e-9)) };
}

// ─── Menulis qty bahan ke baris PO ─────────────────────────────────────────

type BarisQty = { itemId: string; qty: number };

/**
 * Qty sebuah bahan di PO ditulis ke baris-barisnya: satu baris → qty itu;
 * beberapa baris (rincian warna) → dibagi rata, baris terakhir menyerap sisa.
 * Mengembalikan null bila bahan itu belum punya baris (pemanggil yang menambah).
 */
export function tulisQtyBahan<T extends BarisQty>(baris: readonly T[], itemId: string, qty: number): T[] | null {
  const idx = baris.flatMap((b, i) => (b.itemId === itemId ? [i] : []));
  if (idx.length === 0) return null;
  const bagian = bagiRata(qty, idx.length);
  const hasil = [...baris];
  idx.forEach((i, k) => {
    hasil[i] = { ...hasil[i], qty: bagian[k] };
  });
  return hasil;
}

/** Σ qty baris PO untuk satu bahan. */
export function qtyBahanDiPo(baris: readonly BarisQty[], itemId: string): number {
  return baris.reduce((t, b) => (b.itemId === itemId ? t + keSen(b.qty || 0) : t), 0) / 100;
}

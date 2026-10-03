/**
 * Kriteria rencana kirim: konstanta, bawaan, dan pembaca isian tersimpan.
 *
 * Aman untuk komponen klien — tidak mengimpor basis data. Penyusunnya
 * (`rencana.ts`) dan aksi server memakai konstanta yang sama, jadi batas di
 * formulir HP dan batas di server tidak bisa berbeda.
 */

import { HARI_BARU_MAKS } from "@/lib/salesman/saran-tawar";

/**
 * Sumber barang, dari prioritas tertinggi. Urutan ini meneruskan keputusan
 * pesanan cepat yang lama (#211): barang yang belum pernah dikirim dulu, lalu
 * yang biasa dipesan/laku di toko ini — dengan dua sumber bawaan itu hasilnya
 * sama dengan peringkat lama.
 */
export const SUMBER_RENCANA = ["BELUM_DIKIRIM", "LAKU_DI_SINI", "LAKU_DI_TOKO_LAIN", "BARANG_BARU"] as const;
export type SumberRencana = (typeof SUMBER_RENCANA)[number];
export const SUMBER_BAWAAN: SumberRencana[] = ["BELUM_DIKIRIM", "LAKU_DI_SINI"];

export type JumlahPerArtikel = { mode: "PACK" } | { mode: "PCS"; pcs: number };
/** Pilihan cepat jumlah per artikel di formulir. */
export const PCS_CEPAT = [6, 12] as const;

/** Batas atas isian — mencegah salah ketik menjadi pesanan raksasa. */
export const MAKS_PCS_ARTIKEL = 999;
export const MAKS_ARTIKEL = 50;
export const MAKS_SISA_LEWATI = 9999;
export const MAKS_ANGGARAN = 10_000_000_000;
export { HARI_BARU_MAKS };

/** Bawaan formulir. */
export const ARTIKEL_BAWAAN = 10;
export const SISA_LEWATI_BAWAAN = 6;

/** Kriteria yang dikirim HP ke aksi penyusun (selain `storeId`). Server menilai ulang setiap kolomnya. */
export type KriteriaBangun = {
  kategoriIds: string[];
  sumber: SumberRencana[];
  jumlah: JumlahPerArtikel;
  hariBaru: number;
  lewatiSisaMin: number | null;
  maksArtikel: number;
  anggaran: number | null;
};

/** Isian formulir yang diingat per toko di HP (kenyamanan saja — server menilai ulang semuanya). */
export type KriteriaTersimpan = {
  kategoriIds: string[];
  jumlah: JumlahPerArtikel;
  sumber: SumberRencana[];
  hariBaru: number;
  lewatiSisa: { aktif: boolean; min: number };
  maksArtikel: number;
  /** null = tanpa anggaran. Diabaikan untuk toko konsinyasi. */
  anggaran: number | null;
};

export const kunciPenyimpanan = (storeId: string) => `elorae.rencanaKirim.${storeId}`;

const bulat = (v: unknown, min: number, maks: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= maks ? v : null;

/**
 * Baca isian tersimpan. Apa pun yang rusak atau di luar batas jatuh ke bawaan
 * per kolom; kategori yang sudah tidak ada dibuang. null = tidak ada yang bisa dipakai.
 */
export function bacaKriteriaTersimpan(
  raw: string | null,
  opsi: { kategoriAda: ReadonlySet<string>; hariBaruBawaan: number; adaRasio: boolean },
): KriteriaTersimpan | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;

  const kategoriIds = Array.isArray(r.kategoriIds)
    ? [...new Set(r.kategoriIds.filter((k): k is string => typeof k === "string" && opsi.kategoriAda.has(k)))]
    : [];

  let jumlah: JumlahPerArtikel = opsi.adaRasio ? { mode: "PACK" } : { mode: "PCS", pcs: PCS_CEPAT[0] };
  const j = r.jumlah as Record<string, unknown> | null | undefined;
  if (j && typeof j === "object") {
    if (j.mode === "PACK" && opsi.adaRasio) jumlah = { mode: "PACK" };
    const pcs = bulat(j.pcs, 1, MAKS_PCS_ARTIKEL);
    if (j.mode === "PCS" && pcs !== null) jumlah = { mode: "PCS", pcs };
  }

  const sumber = Array.isArray(r.sumber)
    ? SUMBER_RENCANA.filter((s) => (r.sumber as unknown[]).includes(s))
    : [...SUMBER_BAWAAN];

  const ls = r.lewatiSisa as Record<string, unknown> | null | undefined;
  const lewatiSisa = {
    aktif: ls && typeof ls === "object" && typeof ls.aktif === "boolean" ? ls.aktif : true,
    min: (ls && typeof ls === "object" ? bulat(ls.min, 1, MAKS_SISA_LEWATI) : null) ?? SISA_LEWATI_BAWAAN,
  };

  return {
    kategoriIds,
    jumlah,
    sumber: sumber.length > 0 ? sumber : [...SUMBER_BAWAAN],
    hariBaru: bulat(r.hariBaru, 1, HARI_BARU_MAKS) ?? opsi.hariBaruBawaan,
    lewatiSisa,
    maksArtikel: bulat(r.maksArtikel, 1, MAKS_ARTIKEL) ?? ARTIKEL_BAWAAN,
    anggaran: r.anggaran === null ? null : bulat(r.anggaran, 1, MAKS_ANGGARAN),
  };
}

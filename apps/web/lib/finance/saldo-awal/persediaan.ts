import { keRupiah } from "@/lib/receivables/impor/nilai";
import { peranPersediaan, type PeranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { keSen, nilaiKaliHppSen, dariSen } from "./jurnal";

/*
 * Saldo awal persediaan — pembacaan berkas HPP dan pencocokannya dengan stok,
 * murni (dites tanpa basis data, dipakai layar dan penulis).
 *
 * Berkas: kolom "SKU" (SKU varian, atau SKU barang untuk semua variannya) dan
 * "HPP baru" / "HPP" per satuan. Berkas Excel dibaca dengan `XLSX.read(...,
 * { raw: true })` (`baca-berkas.ts`) — tanpa itu "90.000" di CSV terbaca 90.
 *
 * Nilai yang dijurnal adalah SELISIH nilai stok: (qty × HPP baru) − nilai stok
 * sekarang (`totalValue`). Untuk stok tanpa HPP (nilai 0) selisihnya = qty × HPP.
 * Untuk stok yang sudah bernilai, nilai lamanya sudah masuk buku besar lewat
 * jurnalnya sendiri (penerimaan barang, hasil produksi) — menjurnalnya penuh
 * akan mencatatnya dua kali.
 */

export type BarisBerkasHpp = { baris: number; sku: string; hpp: number };
export type GalatBerkasHpp = { baris: number; sku: string; sebab: "HPP_TIDAK_TERBACA" | "HPP_NEGATIF" | "SKU_GANDA" };

export type HasilBacaBerkas = {
  baris: BarisBerkasHpp[];
  galat: GalatBerkasHpp[];
  /** Kolom wajib tidak ditemukan di baris judul mana pun. */
  tanpaJudul: boolean;
};

export const JUDUL_TEMPLAT_PERSEDIAAN = ["SKU", "Nama barang", "Varian", "Tipe", "Qty sistem", "HPP sekarang", "HPP baru"] as const;

function normal(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const JUDUL_SKU = new Set(["sku", "skuvarian", "kodebarang", "kode", "kodesku"]);
const JUDUL_HPP_UTAMA = new Set(["hppbaru"]);
const JUDUL_HPP = new Set(["hpp", "hpprp", "hppsatuan", "hargapokok", "hargapokokpenjualan", "hppperpcs", "hppperunit"]);

function petakanJudul(judul: unknown[]): { sku: number; hpp: number } | null {
  let sku = -1;
  let hppUtama = -1;
  let hpp = -1;
  judul.forEach((sel, i) => {
    const n = normal(sel);
    if (sku < 0 && JUDUL_SKU.has(n)) sku = i;
    if (hppUtama < 0 && JUDUL_HPP_UTAMA.has(n)) hppUtama = i;
    if (hpp < 0 && JUDUL_HPP.has(n)) hpp = i;
  });
  const kolomHpp = hppUtama >= 0 ? hppUtama : hpp;
  return sku >= 0 && kolomHpp >= 0 ? { sku, hpp: kolomHpp } : null;
}

/** Baris lembar (hasil `sheet_to_json(..., { header: 1, raw: true })`) → isian HPP. */
export function bacaLembarHpp(sel: unknown[][]): HasilBacaBerkas {
  let iJudul = -1;
  let kolom: { sku: number; hpp: number } | null = null;
  for (let i = 0; i < Math.min(sel.length, 20); i++) {
    kolom = petakanJudul(sel[i] ?? []);
    if (kolom) {
      iJudul = i;
      break;
    }
  }
  if (!kolom) return { baris: [], galat: [], tanpaJudul: true };

  const baris: BarisBerkasHpp[] = [];
  const galat: GalatBerkasHpp[] = [];
  const dilihat = new Set<string>();
  for (let i = iJudul + 1; i < sel.length; i++) {
    const r = sel[i] ?? [];
    const sku = String(r[kolom.sku] ?? "").trim();
    const mentah = r[kolom.hpp];
    const kosong = mentah === undefined || mentah === null || String(mentah).trim() === "";
    if (!sku) continue;
    if (kosong) continue; // baris templat yang tidak diisi: HPP-nya tidak diubah
    const nomor = i + 1;
    const hpp = keRupiah(mentah);
    if (hpp === null) {
      galat.push({ baris: nomor, sku, sebab: "HPP_TIDAK_TERBACA" });
      continue;
    }
    if (hpp < 0) {
      galat.push({ baris: nomor, sku, sebab: "HPP_NEGATIF" });
      continue;
    }
    const kunci = sku.toUpperCase();
    if (dilihat.has(kunci)) {
      galat.push({ baris: nomor, sku, sebab: "SKU_GANDA" });
      continue;
    }
    dilihat.add(kunci);
    baris.push({ baris: nomor, sku, hpp: dariSen(keSen(hpp)) });
  }
  return { baris, galat, tanpaJudul: false };
}

/** Satu baris stok (`InventoryValue` + barangnya). */
export type BarisStok = {
  ivId: string;
  itemId: string;
  skuBarang: string;
  variantSku: string | null;
  nama: string;
  tipe: string;
  qty: number;
  avgCost: number;
  totalValue: number;
};

export type PeringatanPersediaan = "QTY_NEGATIF" | "QTY_NOL" | "HPP_LAMA_BEDA";

export type BarisPratinjauPersediaan = {
  ivId: string;
  itemId: string;
  variantSku: string | null;
  sku: string;
  nama: string;
  peran: PeranPersediaan;
  qty: number;
  hppLama: number;
  hppBaru: number;
  nilaiLama: number;
  nilaiBaru: number;
  /** Yang dijurnal: nilai baru − nilai lama. */
  selisih: number;
  peringatan: PeringatanPersediaan[];
};

export type PratinjauPersediaan = {
  baris: BarisPratinjauPersediaan[];
  /** Isian yang SKU-nya tidak dikenal (tidak ada barisnya di stok). */
  tidakDikenal: { baris?: number; sku: string }[];
  /** Selisih per peran dalam sen — inilah yang dijurnal. */
  selisihPerPeranSen: Record<PeranPersediaan, number>;
  totalNilaiBaru: number;
  totalSelisih: number;
};

export function skuTampil(s: Pick<BarisStok, "skuBarang" | "variantSku">): string {
  return s.variantSku && s.variantSku.trim() ? s.variantSku : s.skuBarang;
}

/** Varian kosong (`null` atau `""`) adalah satu hal: barang tanpa varian. */
export function varianNormal(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

function kunciStok(itemId: string, variantSku: string | null): string {
  return `${itemId}\u0000${varianNormal(variantSku) ?? ""}`;
}

export type IsianHpp = { itemId: string; variantSku: string | null; hpp: number; baris?: number; sku?: string };

/**
 * Isian berkas (kunci SKU) → isian per (barang, varian). SKU varian mengenai
 * barisnya sendiri; SKU barang mengenai SEMUA varian barang itu yang tidak
 * disebut sendiri lewat SKU variannya. Huruf besar/kecil diabaikan.
 */
export function petakanBerkasKeStok(
  berkas: readonly BarisBerkasHpp[],
  stok: readonly BarisStok[],
): { isian: IsianHpp[]; tidakDikenal: { baris?: number; sku: string }[] } {
  const perVarian = new Map<string, BarisStok[]>();
  const perBarang = new Map<string, BarisStok[]>();
  for (const s of stok) {
    const v = varianNormal(s.variantSku);
    if (v) {
      const k = v.trim().toUpperCase();
      perVarian.set(k, [...(perVarian.get(k) ?? []), s]);
    }
    const kb = s.skuBarang.trim().toUpperCase();
    perBarang.set(kb, [...(perBarang.get(kb) ?? []), s]);
  }
  const pilihan = new Map<string, IsianHpp>();
  const dariBarang = new Map<string, IsianHpp>();
  const tidakDikenal: { baris?: number; sku: string }[] = [];
  for (const b of berkas) {
    const k = b.sku.trim().toUpperCase();
    const varian = perVarian.get(k);
    const sasaran = varian ? pilihan : dariBarang;
    const baris = varian ?? perBarang.get(k);
    if (!baris) {
      tidakDikenal.push({ baris: b.baris, sku: b.sku });
      continue;
    }
    for (const s of baris) {
      const variantSku = varianNormal(s.variantSku);
      sasaran.set(kunciStok(s.itemId, variantSku), { itemId: s.itemId, variantSku, hpp: b.hpp, baris: b.baris, sku: skuTampil(s) });
    }
  }
  for (const [k, isi] of dariBarang) if (!pilihan.has(k)) pilihan.set(k, isi);
  return { isian: [...pilihan.values()], tidakDikenal };
}

/**
 * Isian per (barang, varian) → pratinjau. Isian yang tidak punya baris stok
 * masuk `tidakDikenal`. Baris stok kembar `null`/`""` (varian kosong) keduanya
 * kena isian yang sama.
 */
export function pratinjauPersediaan(isian: readonly IsianHpp[], stok: readonly BarisStok[]): PratinjauPersediaan {
  const perKunci = new Map<string, BarisStok[]>();
  for (const s of stok) {
    const k = kunciStok(s.itemId, s.variantSku);
    perKunci.set(k, [...(perKunci.get(k) ?? []), s]);
  }
  const baris: BarisPratinjauPersediaan[] = [];
  const tidakDikenal: { baris?: number; sku: string }[] = [];
  const selisihPerPeranSen: Record<PeranPersediaan, number> = { INVENTORY: 0, INVENTORY_FG: 0 };
  let totalBaruSen = 0;
  let totalSelisihSen = 0;
  for (const i of isian) {
    const cocok = perKunci.get(kunciStok(i.itemId, i.variantSku));
    if (!cocok || cocok.length === 0) {
      tidakDikenal.push({ ...(i.baris ? { baris: i.baris } : {}), sku: i.sku ?? i.variantSku ?? i.itemId });
      continue;
    }
    for (const s of cocok) {
      const peran = peranPersediaan(s.tipe);
      const nilaiBaruSen = nilaiKaliHppSen(s.qty, i.hpp);
      const nilaiLamaSen = keSen(s.totalValue);
      const selisihSen = nilaiBaruSen - nilaiLamaSen;
      const peringatan: PeringatanPersediaan[] = [];
      if (s.qty < 0) peringatan.push("QTY_NEGATIF");
      if (s.qty === 0) peringatan.push("QTY_NOL");
      if (keSen(s.avgCost) !== 0 && keSen(s.avgCost) !== keSen(i.hpp)) peringatan.push("HPP_LAMA_BEDA");
      selisihPerPeranSen[peran] += selisihSen;
      totalBaruSen += nilaiBaruSen;
      totalSelisihSen += selisihSen;
      baris.push({
        ivId: s.ivId,
        itemId: s.itemId,
        variantSku: s.variantSku,
        sku: skuTampil(s),
        nama: s.nama,
        peran,
        qty: s.qty,
        hppLama: s.avgCost,
        hppBaru: i.hpp,
        nilaiLama: dariSen(nilaiLamaSen),
        nilaiBaru: dariSen(nilaiBaruSen),
        selisih: dariSen(selisihSen),
        peringatan,
      });
    }
  }
  return { baris, tidakDikenal, selisihPerPeranSen, totalNilaiBaru: dariSen(totalBaruSen), totalSelisih: dariSen(totalSelisihSen) };
}

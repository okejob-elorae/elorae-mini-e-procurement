/**
 * HPP per pcs barang jadi untuk formulir barang — HANYA DIBACA.
 *
 * Murni (tanpa Prisma), jadi aman diimpor komponen klien. Pembacanya ada di
 * `./hpp-barang-queries.ts` (khusus server).
 *
 * Pemilik menetapkan harga jual sendiri dari HPP (keputusan pemilik
 * 2026-10-08: "harga jual biar saya yang mengisi sendiri, tidak otomatis"),
 * jadi di sini tidak ada saran harga dan tidak ada margin — rumus harga adalah
 * hak pemilik.
 *
 * - Angka utama = Σ `InventoryValue.totalValue` ÷ Σ `qtyOnHand` atas baris
 *   ber-qty > 0 (semua varian): biaya rata-rata barang yang sekarang di gudang.
 * - Stok 0 → nilai persediaan penerimaan barang jadi terakhir ÷ pcs lolosnya.
 * - Rincian dari penerimaan terakhir: bahan, jahit (semua jasa langkah WO),
 *   dan biaya tambahan per pcs. Jahit = nilai − bahan − tambahan, BUKAN
 *   `serviceCost`: tagihan jasa memuat PPN pemasok, yang bila Elorae PKP menjadi
 *   PPN Masukan dan tidak ikut HPP. Penerimaan dari sebelum ongkos jahit masuk
 *   HPP (tanpa jasa dan tanpa biaya tambahan) hanya punya bahan.
 */
import { Decimal } from "decimal.js";

/** Angka dari Prisma (Decimal), teks, atau angka biasa. */
export type AngkaHpp = Decimal.Value | { toString(): string } | null | undefined;

export type BarisStokHpp = { qtyOnHand: AngkaHpp; totalValue: AngkaHpp };

export type PenerimaanHpp = {
  docNumber: string;
  woDocNumber: string;
  receivedAt: Date;
  qtyAccepted: AngkaHpp;
  materialCost: AngkaHpp;
  serviceCost: AngkaHpp;
  additionalCost: AngkaHpp;
  totalCostValue: AngkaHpp;
};

export type RincianHppPenerimaan = {
  /** Nomor penerimaan barang jadi. */
  penerimaan: string;
  /** Nomor perintah kerja (WO) penerimaan itu. */
  wo: string;
  /** Waktu penerimaan, ISO. */
  tanggal: string;
  bahanPerPcs: number;
  /** null = penerimaan dari sebelum ongkos jahit masuk HPP (bahan saja). */
  jahitPerPcs: number | null;
  tambahanPerPcs: number | null;
};

export type HppBarang = {
  /** null = belum ada HPP (tanpa stok bernilai dan tanpa penerimaan). */
  perPcs: number | null;
  /** STOK = rata-rata stok sekarang; PENERIMAAN = stok 0, dari penerimaan terakhir. */
  sumber: "STOK" | "PENERIMAAN" | null;
  rincian: RincianHppPenerimaan | null;
};

const NOL = new Decimal(0);

function angka(v: AngkaHpp): Decimal | null {
  if (v == null) return null;
  const d = new Decimal(typeof v === "number" || typeof v === "string" || v instanceof Decimal ? v : v.toString());
  return d.isFinite() ? d : null;
}

const duaDesimal = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

function rincianPenerimaan(p: PenerimaanHpp): { rincian: RincianHppPenerimaan; perPcs: number } | null {
  const qty = angka(p.qtyAccepted);
  if (!qty || qty.lte(0)) return null;
  const nilai = angka(p.totalCostValue) ?? NOL;
  const gayaLama = p.serviceCost == null && p.additionalCost == null;
  // Penerimaan lama: `totalCostValue` = bahan seluruhnya (`bagianBahanPenerimaan`).
  const bahan = angka(p.materialCost) ?? nilai;
  const tambahan = gayaLama ? null : (angka(p.additionalCost) ?? NOL);
  const jahit = gayaLama ? null : Decimal.max(NOL, nilai.minus(bahan).minus(tambahan ?? NOL));
  return {
    perPcs: duaDesimal(nilai.div(qty)),
    rincian: {
      penerimaan: p.docNumber,
      wo: p.woDocNumber,
      tanggal: p.receivedAt.toISOString(),
      bahanPerPcs: duaDesimal(bahan.div(qty)),
      jahitPerPcs: jahit ? duaDesimal(jahit.div(qty)) : null,
      tambahanPerPcs: tambahan ? duaDesimal(tambahan.div(qty)) : null,
    },
  };
}

export function hitungHppBarang(stok: BarisStokHpp[], penerimaan: PenerimaanHpp | null): HppBarang {
  let qty = NOL;
  let nilai = NOL;
  for (const b of stok) {
    const q = angka(b.qtyOnHand);
    if (!q || q.lte(0)) continue;
    qty = qty.plus(q);
    nilai = nilai.plus(angka(b.totalValue) ?? NOL);
  }
  const dariPenerimaan = penerimaan ? rincianPenerimaan(penerimaan) : null;
  const rincian = dariPenerimaan?.rincian ?? null;
  if (qty.gt(0)) return { perPcs: duaDesimal(nilai.div(qty)), sumber: "STOK", rincian };
  if (dariPenerimaan) return { perPcs: dariPenerimaan.perPcs, sumber: "PENERIMAAN", rincian };
  return { perPcs: null, sumber: null, rincian: null };
}

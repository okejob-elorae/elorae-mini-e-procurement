// Bukan aksi server — pembaca nilai bahan produksi untuk rekonsiliasi buku
// besar ↔ kartu stok (layar integritas / rekonsiliasi persediaan). KHUSUS
// SERVER: komponen klien hanya boleh `import type` dari berkas ini.

import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "@elorae/db";
import { gerakStokPerDokumen } from "@/lib/inventory/kartu-stok-queries";
import { bagianBahanPenerimaan } from "./biaya-penerimaan";
import { nilaiBahanKembaliWo } from "./kembali-bahan-writer";

type Klien = Prisma.TransactionClient | typeof prisma;

const rp = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export type BahanDiProduksiWo = {
  woId: string;
  docNumber: string;
  status: string;
  /** Σ nilai pengeluaran bahan ke WO (`MaterialIssue.totalCost`). */
  keluar: number;
  /** Σ nilai bahan yang sudah kembali ke gudang. */
  kembali: number;
  /** Σ bagian bahan yang sudah dipikul penerimaan barang jadi (dan dikredit dari persediaan bahan). */
  dibebankan: number;
  /** keluar − kembali − dibebankan: bahan yang sudah keluar dari kartu stok tetapi belum dikredit dari buku besar. */
  diProduksi: number;
};

/**
 * Nilai bahan yang sedang "di produksi" (di CMT) per WO terbuka.
 *
 * Pengeluaran bahan tidak dijurnal (tidak ada akun barang dalam proses):
 * kartu stok bahan berkurang saat bahan keluar, persediaan bahan di buku besar
 * baru berkurang saat barang jadinya diterima (`FG_RECEIPT`, CR bagian bahan).
 * Jadi saldo `INVENTORY` di buku besar = nilai kartu stok bahan + angka ini.
 * Rekonsiliasi persediaan WAJIB menambahkannya, kalau tidak setiap WO yang
 * sedang berjalan terbaca sebagai selisih.
 *
 * Hanya WO yang belum selesai/batal (ISSUED, IN_PRODUCTION, PARTIAL) — WO
 * COMPLETED sudah menutup sisa biaya bahannya di penerimaan penutup. `woIds`
 * membatasi cakupan (tes di basis data bersama).
 */
export async function nilaiBahanDiProduksi(
  opsi: { woIds?: string[] } = {},
  klien: Klien = prisma,
): Promise<{ total: number; perWo: BahanDiProduksiWo[] }> {
  const wos = await klien.workOrder.findMany({
    where: {
      status: { in: ["ISSUED", "IN_PRODUCTION", "PARTIAL"] },
      issues: { some: {} },
      ...(opsi.woIds ? { id: { in: opsi.woIds } } : {}),
    },
    orderBy: { docNumber: "asc" },
    select: {
      id: true,
      docNumber: true,
      status: true,
      issues: { select: { totalCost: true } },
      receipts: { select: { materialCost: true, totalCostValue: true } },
    },
  });
  const perWo: BahanDiProduksiWo[] = [];
  let total = new Decimal(0);
  for (const wo of wos) {
    const keluar = wo.issues.reduce((s, i) => s.plus(i.totalCost.toString()), new Decimal(0));
    const kembali = await nilaiBahanKembaliWo(klien, wo.id);
    const dibebankan = wo.receipts.reduce((s, r) => s.plus(bagianBahanPenerimaan(r)), new Decimal(0));
    const diProduksi = Decimal.max(0, keluar.minus(kembali).minus(dibebankan));
    total = total.plus(diProduksi);
    perWo.push({
      woId: wo.id,
      docNumber: wo.docNumber,
      status: wo.status,
      keluar: rp(keluar),
      kembali: rp(kembali),
      dibebankan: rp(dibebankan),
      diProduksi: rp(diProduksi),
    });
  }
  return { total: rp(total), perWo };
}

export type SelisihPengeluaranBahan = {
  issueId: string;
  docNumber: string;
  woId: string;
  issuedAt: Date;
  /** Nilai yang tercatat di dokumen pengeluaran (dan dipikul barang jadi). */
  tercatat: number;
  /** Nilai yang benar-benar keluar dari kartu stok (`gerakStokPerDokumen` MaterialIssue). */
  keluarStok: number;
  selisih: number;
};

/**
 * Pengeluaran bahan yang nilainya berbeda dari yang keluar dari kartu stok.
 * Sejak 2026-10-08 `issueMaterials` mencatat nilai kartu stok, jadi daftar ini
 * hanya berisi pengeluaran LAMA (dicatat dengan harga ketik / harga PO + PPN).
 * Selisihnya ikut dipikul barang jadi WO itu dan dikredit dari persediaan bahan,
 * jadi buku besar bahan menyimpang dari kartu stoknya sebesar itu. Tidak ada
 * perbaikan otomatis — angka ini untuk dilihat dan diputuskan. Pengeluaran yang
 * nilai keluarnya tidak tercatat di kartu stok tidak bisa dibandingkan dan
 * dilewati, bukan dianggap keluar nol.
 */
export async function selisihNilaiPengeluaranBahan(
  opsi: { woIds?: string[]; sejak?: Date; sampai?: Date; batas?: number } = {},
  klien: Klien = prisma,
): Promise<SelisihPengeluaranBahan[]> {
  const issues = await klien.materialIssue.findMany({
    where: {
      ...(opsi.woIds ? { woId: { in: opsi.woIds } } : {}),
      ...(opsi.sejak || opsi.sampai
        ? { issuedAt: { ...(opsi.sejak ? { gte: opsi.sejak } : {}), ...(opsi.sampai ? { lte: opsi.sampai } : {}) } }
        : {}),
    },
    orderBy: { issuedAt: "asc" },
    take: Math.max(1, Math.min(opsi.batas ?? 500, 5_000)),
    select: { id: true, docNumber: true, woId: true, issuedAt: true, totalCost: true },
  });
  if (issues.length === 0) return [];
  const gerak = await gerakStokPerDokumen(
    klien,
    "MaterialIssue",
    issues.map((i) => i.id),
  );
  const hasil: SelisihPengeluaranBahan[] = [];
  for (const i of issues) {
    const g = gerak.get(i.id);
    if (g === null) continue;
    const tercatat = new Decimal(i.totalCost.toString());
    const keluarStok = new Decimal(g?.total ?? 0);
    const selisih = tercatat.minus(keluarStok);
    if (selisih.abs().lt(0.01)) continue;
    hasil.push({
      issueId: i.id,
      docNumber: i.docNumber,
      woId: i.woId,
      issuedAt: i.issuedAt,
      tercatat: rp(tercatat),
      keluarStok: rp(keluarStok),
      selisih: rp(selisih),
    });
  }
  return hasil;
}

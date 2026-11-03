// Bukan aksi server — KHUSUS SERVER (membaca basis data lewat klien yang diberikan).
// Komponen klien hanya boleh `import type` dari berkas ini; nilainya di `./riwayat-hpp.ts`.

import type { Prisma, PrismaClient } from "@elorae/db";
import { STATUS_KOREKSI_UTANG } from "@/lib/vendor-billing/koreksi-utang-aturan";
import {
  HALAMAN_RIWAYAT_HPP,
  hppTerbaruDari,
  susunRiwayatHpp,
  type HppTerbaru,
  type KoreksiHpp,
  type RiwayatHpp,
} from "./riwayat-hpp";
import { parseItemVariants, variantSelectOptions } from "./variants";

type Klien = Prisma.TransactionClient | PrismaClient;

/**
 * Batas atas baris satu permintaan — penjaga saja. "Muat lagi" berjalan dengan
 * penunjuk waktu (`sebelum`), jadi riwayat yang lebih panjang tetap terbuka
 * sampai habis, halaman demi halaman.
 */
export const BATAS_MAKS_RIWAYAT_HPP = 200;

export type OpsiRiwayatHpp = {
  /** Baris per halaman; bawaan `HALAMAN_RIWAYAT_HPP`. */
  batas?: number;
  /** Penunjuk `berikutnya` dari halaman sebelumnya; kosong = dari yang terbaru. */
  sebelum?: string | null;
};

const ENTRI_SELECT = {
  id: true,
  refId: true,
  refDocNumber: true,
  variantSku: true,
  qty: true,
  totalCost: true,
  balanceQty: true,
  balanceValue: true,
  createdAt: true,
} as const;

/**
 * Rincian tersimpan sebuah koreksi utang pemasok (`SupplierPayableCorrection.breakdown`): larik
 * per dokumen `{ dokumen: "GRN" | "FG_RECEIPT", dokumenId, itemId, variantSku, persediaan, … }`.
 * Hanya bagian barang ini di dokumen yang diminta; entri yang tidak terbaca dilewati.
 */
function rincianKoreksiBarang(raw: unknown, itemId: string, dokumen: ReadonlySet<string>): KoreksiHpp[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const hasil: KoreksiHpp[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    if (e.dokumen !== "GRN" && e.dokumen !== "FG_RECEIPT") continue;
    if (typeof e.dokumenId !== "string" || e.itemId !== itemId || !dokumen.has(e.dokumenId)) continue;
    const persediaan = typeof e.persediaan === "number" ? e.persediaan : Number(e.persediaan);
    if (!Number.isFinite(persediaan)) continue;
    hasil.push({
      dokumen: e.dokumen,
      dokumenId: e.dokumenId,
      variantSku: typeof e.variantSku === "string" ? e.variantSku : null,
      persediaan,
    });
  }
  return hasil;
}

function batasSah(batas: number): number {
  if (!Number.isFinite(batas)) return HALAMAN_RIWAYAT_HPP;
  return Math.min(BATAS_MAKS_RIWAYAT_HPP, Math.max(1, Math.floor(batas)));
}

/** Penunjuk yang tidak terbaca sebagai waktu diabaikan (dibaca dari yang terbaru). */
function sebelumSah(sebelum: string | null | undefined): Date | null {
  if (typeof sebelum !== "string" || sebelum === "") return null;
  const t = new Date(sebelum);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Satu halaman riwayat HPP satu barang, terbaru dulu, sekitar `batas` baris
 * (lihat `./riwayat-hpp.ts`). Hanya gudang utama (MAIN) dan hanya barang
 * MASUK: penerimaan barang jadi dari WO barang ini dan entri buku stok GRN-nya.
 * Penerimaan yang semuanya cacat tidak punya pcs dan tidak tampil. Halaman
 * berikutnya: panggil lagi dengan `sebelum` = `berikutnya` hasil ini.
 */
export async function bacaRiwayatHpp(klien: Klien, itemId: string, opsi: OpsiRiwayatHpp = {}): Promise<RiwayatHpp> {
  const n = batasSah(opsi.batas ?? HALAMAN_RIWAYAT_HPP);
  // Satu lebih dari batas per sumber: peristiwa ke-(n+1) menandai masih ada yang lebih lama.
  const ambil = n + 1;
  const sebelum = sebelumSah(opsi.sebelum);
  const entriGrn = { itemId, locationType: "MAIN", refType: "GRN", type: "IN" } as const;
  const [item, penerimaan, grupGrn] = await Promise.all([
    klien.item.findUnique({ where: { id: itemId }, select: { variants: true } }),
    klien.fGReceipt.findMany({
      where: {
        wo: { finishedGoodId: itemId },
        qtyAccepted: { gt: 0 },
        ...(sebelum ? { receivedAt: { lt: sebelum } } : {}),
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: ambil,
      select: {
        id: true,
        docNumber: true,
        receivedAt: true,
        woId: true,
        qtyAccepted: true,
        avgCostPerUnit: true,
        totalCostValue: true,
        materialCost: true,
        skuBreakdown: true,
        wo: { select: { docNumber: true } },
      },
    }),
    // Per GRN, bukan per entri: waktu GRN = entri terbarunya untuk barang ini,
    // jadi GRN dengan banyak varian tidak pernah terbelah antarhalaman, dan GRN
    // yang sudah tampil (waktunya ≥ penunjuk) tidak terbaca ulang.
    klien.stockLedgerEntry.groupBy({
      by: ["refId"],
      where: entriGrn,
      _max: { createdAt: true },
      having: sebelum ? { createdAt: { _max: { lt: sebelum } } } : undefined,
      orderBy: [{ _max: { createdAt: "desc" } }, { refId: "desc" }],
      take: ambil,
    }),
  ]);

  // `in: []` mencocokkan nol baris, jadi tidak perlu cabang untuk daftar kosong.
  const idPenerimaan = penerimaan.map((p) => p.id);
  const idGrn = grupGrn.map((g) => g.refId);
  const [entriPenerimaan, entriPembelian, grn] = await Promise.all([
    klien.stockLedgerEntry.findMany({
      where: { itemId, locationType: "MAIN", refType: "FGReceipt", type: "IN", refId: { in: idPenerimaan } },
      select: ENTRI_SELECT,
    }),
    // Semua entri GRN yang terbaca, lengkap per GRN.
    klien.stockLedgerEntry.findMany({ where: { ...entriGrn, refId: { in: idGrn } }, select: ENTRI_SELECT }),
    klien.gRN.findMany({
      where: { id: { in: idGrn } },
      select: {
        id: true,
        docNumber: true,
        poId: true,
        po: { select: { docNumber: true } },
        ownerDeclinedAt: true,
        items: true,
      },
    }),
  ]);

  // Selisih harga invoice yang DITERIMA pemilik untuk dokumen di halaman ini (P49): GRN langsung,
  // penerimaan barang jadi lewat langkah jasa WO-nya.
  const idWo = [...new Set(penerimaan.map((p) => p.woId))];
  const idLangkah = idWo.length
    ? (await klien.workOrderStep.findMany({ where: { woId: { in: idWo } }, select: { id: true } })).map((l) => l.id)
    : [];
  const sumberKoreksi = [
    ...(idGrn.length ? [{ sourceType: "GRN", sourceId: { in: idGrn } }] : []),
    ...(idLangkah.length ? [{ sourceType: "WO_STEP", sourceId: { in: idLangkah } }] : []),
  ];
  const barisKoreksi = sumberKoreksi.length
    ? await klien.supplierPayableCorrection.findMany({
        where: { status: STATUS_KOREKSI_UTANG.DITERIMA, OR: sumberKoreksi },
        select: { breakdown: true },
      })
    : [];
  const dokumenHalaman = new Set([...idPenerimaan, ...idGrn]);
  const koreksi = barisKoreksi.flatMap((k) => rincianKoreksiBarang(k.breakdown, itemId, dokumenHalaman));

  const labelVarian: Record<string, string> = {};
  for (const o of variantSelectOptions(parseItemVariants(item?.variants))) labelVarian[o.sku] = o.label;

  return susunRiwayatHpp({
    itemId,
    penerimaan: penerimaan.map((p) => ({ ...p, woDocNumber: p.wo.docNumber })),
    entriPenerimaan,
    entriPembelian,
    grn: grn.map((g) => ({ ...g, poDocNumber: g.po?.docNumber ?? null })),
    labelVarian,
    batas: n,
    ambil,
    koreksi,
  });
}

/**
 * HPP terbaru barang ini (dasar rekomendasi harga jual). `awal` = halaman
 * pertama yang sudah dibaca pemanggil; kalau HPP terbaru tidak ada di sana
 * (semua baris terbarunya tanpa bahan, ditolak, atau tanpa nilai), halaman
 * berikutnya dibaca lewat penunjuknya sampai ketemu atau riwayatnya habis.
 */
export async function bacaHppTerbaru(klien: Klien, itemId: string, awal?: RiwayatHpp): Promise<HppTerbaru | null> {
  let riwayat = awal ?? (await bacaRiwayatHpp(klien, itemId));
  for (;;) {
    const terbaru = hppTerbaruDari(riwayat.baris);
    const sebelum = riwayat.berikutnya;
    if (terbaru || !riwayat.adaLagi || !sebelum) return terbaru;
    riwayat = await bacaRiwayatHpp(klien, itemId, { sebelum, batas: BATAS_MAKS_RIWAYAT_HPP });
    // Penjaga: penunjuk harus mundur. Kalau tidak, berhenti daripada berputar.
    if (riwayat.berikutnya != null && riwayat.berikutnya >= sebelum) return hppTerbaruDari(riwayat.baris);
  }
}

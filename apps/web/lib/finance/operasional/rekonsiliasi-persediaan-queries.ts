import { prisma, Prisma, sqlId } from "@elorae/db";
import { muatStokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import { saringJurnalLaporan } from "@/lib/finance/reports/balances";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { nilaiBahanDiProduksi } from "@/lib/production/biaya-bahan-queries";
import { biayaSatuanKonsi } from "./biaya-konsi";
import { nilaiGudangRusak } from "./nilai-rusak-queries";
import {
  PERAN_REKON_PERSEDIAAN,
  SUMBER_STOK_TANPA_JURNAL,
  susunRekonPersediaan,
  type AkunPeta,
  type BarisRekonPersediaan,
  type PeranRekonPersediaan,
} from "./rekonsiliasi-persediaan";

/*
 * Pembaca rekonsiliasi persediaan — KHUSUS SERVER. Aturannya murni di
 * `rekonsiliasi-persediaan.ts`. Nilai sistem dibaca SEKARANG; saldo buku besar
 * dari semua jurnal yang berlaku (termasuk yang bertanggal di depan karena
 * periodenya digeser).
 */

const angka = (v: unknown): number => Number(v ?? 0);

export type RincianSistem = {
  bahanGudang: number;
  bahanDiProduksi: number;
  barangJadi: number;
  konsinyasi: number;
  /** Barang konsinyasi yang biayanya memakai harga cadangan (dikirim sebelum pemindahan stok tercatat). */
  konsinyasiCadangan: number;
  tokoKonsinyasi: number;
  gudangRusak: number;
  /** Gerakan masuk gudang rusak lama tanpa nilai (dinilai dengan harga rata-rata sekarang). */
  gudangRusakTanpaNilai: number;
  van: number;
};

export type PenyebabDiketahui = {
  /** Gerakan kartu stok yang tidak pernah dijurnal sejak tanggal mulai, per sumber. */
  stokTanpaJurnal: Array<{ source: string; jumlah: number; nilai: number }>;
  /** Retur pemasok yang stoknya sudah keluar (diproses) tetapi belum selesai — jurnalnya menunggu "selesai". */
  returPemasokDiproses: { jumlah: number; nilai: number };
};

export type RekonsiliasiPersediaan = {
  baris: BarisRekonPersediaan[];
  rincian: RincianSistem;
  penyebab: PenyebabDiketahui;
  tanggalMulai: string | null;
};

/** Nilai sistem per peran persediaan, beserta rinciannya. */
export async function nilaiSistemPersediaan(sekarang = new Date()): Promise<{ sistem: Record<PeranRekonPersediaan, number>; rincian: RincianSistem }> {
  // Kartu stok gudang utama per tipe barang.
  const stok = await prisma.inventoryValue.findMany({ select: { totalValue: true, item: { select: { type: true } } } });
  let bahanSen = 0;
  let jadiSen = 0;
  for (const s of stok) {
    const v = Math.round(angka(s.totalValue) * 100);
    if (s.item.type === "FINISHED_GOOD") jadiSen += v;
    else bahanSen += v;
  }

  const [diProduksi, rusak, van] = await Promise.all([
    nilaiBahanDiProduksi({}, prisma),
    nilaiGudangRusak(prisma),
    prisma.vanStock.findMany({ select: { qty: true, avgCost: true } }),
  ]);
  const vanSen = van.reduce((s, v) => s + Math.round(angka(v.qty) * angka(v.avgCost) * 100), 0);

  // Stok di toko konsinyasi (buku toko bila ada, kalau tidak titipan) × biaya saat dikirim.
  const toko = await prisma.store.findMany({ where: { termsType: "KONSI" }, select: { id: true } });
  const stokToko = await muatStokDiToko(
    toko.map((t) => t.id),
    sekarang,
  );
  const qtyPerBarang = new Map<string, number>();
  for (const s of stokToko.values()) {
    for (const b of s.baris) qtyPerBarang.set(b.itemId, (qtyPerBarang.get(b.itemId) ?? 0) + b.qty);
  }
  const biaya = await biayaSatuanKonsi(prisma, [...qtyPerBarang.keys()], sekarang);
  let konsiSen = 0;
  let cadangan = 0;
  for (const [itemId, qty] of qtyPerBarang) {
    const b = biaya.get(itemId);
    if (!b || qty === 0) continue;
    if (b.sumber !== "KIRIMAN") cadangan += 1;
    konsiSen += Math.round(qty * b.biaya * 100);
  }

  const bahanDiProduksi = Math.round(diProduksi.total * 100);
  return {
    sistem: {
      INVENTORY: (bahanSen + bahanDiProduksi) / 100,
      INVENTORY_FG: jadiSen / 100,
      INVENTORY_CONSIGNMENT: konsiSen / 100,
      INVENTORY_DAMAGED: rusak.total,
      INVENTORY_VAN: vanSen / 100,
    },
    rincian: {
      bahanGudang: bahanSen / 100,
      bahanDiProduksi: bahanDiProduksi / 100,
      barangJadi: jadiSen / 100,
      konsinyasi: konsiSen / 100,
      konsinyasiCadangan: cadangan,
      tokoKonsinyasi: toko.length,
      gudangRusak: rusak.total,
      gudangRusakTanpaNilai: rusak.masukTanpaNilai,
      van: vanSen / 100,
    },
  };
}

/** Saldo (debit − kredit) akun-akun ini dari semua jurnal yang berlaku. */
async function saldoAkun(ids: string[]): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  if (ids.length === 0) return hasil;
  const rows = await prisma.journalLine.groupBy({
    by: ["chartAccountId"],
    where: { chartAccountId: { in: ids }, journal: saringJurnalLaporan({}, { sertakanTutupTahun: true }) },
    _sum: { debit: true, credit: true },
  });
  for (const r of rows) hasil.set(r.chartAccountId, angka(r._sum.debit) - angka(r._sum.credit));
  return hasil;
}

async function penyebabDiketahui(mulai: Date | null): Promise<PenyebabDiketahui> {
  if (!mulai) return { stokTanpaJurnal: [], returPemasokDiproses: { jumlah: 0, nilai: 0 } };
  const stok = await prisma.$queryRaw<Array<{ source: string; jumlah: bigint | number; nilai: unknown }>>(Prisma.sql`
    SELECT a.${sqlId("source")} AS ${sqlId("source")}, COUNT(*) AS ${sqlId("jumlah")},
      SUM(a.${sqlId("newQty")} * a.${sqlId("newAvgCost")} - a.${sqlId("prevQty")} * a.${sqlId("prevAvgCost")}) AS ${sqlId("nilai")}
    FROM ${sqlId("StockAdjustment")} a
    WHERE a.${sqlId("createdAt")} >= ${mulai} AND a.${sqlId("source")} IN (${Prisma.join([...SUMBER_STOK_TANPA_JURNAL])})
    GROUP BY a.${sqlId("source")}
  `);
  const diproses = await prisma.vendorReturn.findMany({
    where: { status: "PROCESSED", processedAt: { gte: mulai } },
    select: { id: true },
  });
  const gerak = diproses.length
    ? await prisma.stockMovement.aggregate({
        where: { refType: "VENDOR_RETURN", refId: { in: diproses.map((r) => r.id) } },
        _sum: { totalCost: true },
      })
    : null;
  return {
    stokTanpaJurnal: stok
      .map((s) => ({ source: s.source, jumlah: Number(s.jumlah), nilai: Math.round(angka(s.nilai) * 100) / 100 }))
      .filter((s) => s.jumlah > 0),
    returPemasokDiproses: { jumlah: diproses.length, nilai: Math.abs(angka(gerak?._sum.totalCost)) },
  };
}

export async function rekonsiliasiPersediaan(sekarang = new Date()): Promise<RekonsiliasiPersediaan> {
  const peta = await prisma.journalAccountMapping.findMany({
    where: { role: { in: [...PERAN_REKON_PERSEDIAAN] } },
    select: { role: true, account: { select: { id: true, code: true, name: true } } },
  });
  const pemetaan = new Map<PeranRekonPersediaan, AkunPeta>(peta.map((p) => [p.role as PeranRekonPersediaan, p.account]));
  const [saldo, nilai, mulai] = await Promise.all([
    saldoAkun([...new Set(peta.map((p) => p.account.id))]),
    nilaiSistemPersediaan(sekarang),
    readGlCutover(),
  ]);
  return {
    baris: susunRekonPersediaan({ pemetaan, saldoAkun: saldo, sistem: nilai.sistem }),
    rincian: nilai.rincian,
    penyebab: await penyebabDiketahui(mulai),
    tanggalMulai: mulai ? mulai.toISOString() : null,
  };
}

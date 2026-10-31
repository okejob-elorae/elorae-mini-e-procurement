// Bukan aksi server — pembaca hutang jasa produksi (ongkos jahit/CMT dan jasa
// langkah WO lainnya) per pemasok, untuk pembayaran pemasok. KHUSUS SERVER:
// komponen klien hanya boleh `import type` dari berkas ini.

import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "@elorae/db";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bagiHutangJasaPerLangkah, nilaiJasaKumulatif } from "./biaya-jasa";

type Klien = Prisma.TransactionClient | typeof prisma;

/** `SupplierPaymentAllocation.targetType` untuk pembayaran yang melunasi satu langkah WO. */
export const TARGET_ALOKASI_LANGKAH_WO = "WO_STEP";

/** Hutang jasa satu langkah WO (satu pemasok). Rupiah, dua desimal. */
export type BarisHutangJasa = {
  /** `WorkOrderStep.id` — `targetId` alokasi pembayarannya. */
  stepId: string;
  woId: string;
  woDocNumber: string;
  urutan: number;
  namaLangkah: string | null;
  supplierId: string;
  hargaPerPcs: number;
  hargaTermasukPpn: boolean;
  /** Pcs lolos yang jasanya SUDAH dijurnal ke hutang usaha. */
  qtyTerhutang: number;
  /** Tagihan jasa (DPP + PPN pemasok) yang sudah dikredit ke hutang usaha. */
  hutang: number;
  /** Nilai jasa tanpa PPN — dasar pemotongan PPh 23 (badan) / PPh 21 (perorangan). */
  dasarPotong: number;
  /** PPN yang dipungut pemasok = hutang − dasarPotong. */
  ppn: number;
  /** Σ alokasi pembayaran (bruto, sebelum potongan PPh) ke langkah ini, pembayaran yang tidak dibatalkan. */
  dibayar: number;
  /** hutang − dibayar (negatif = lebih bayar). */
  sisa: number;
};

export type HutangJasaPemasok = {
  supplierId: string;
  kodePemasok: string;
  namaPemasok: string;
  /** `Supplier.taxWithholding` (null / PPH23 / PPH21 / PPH4_2). */
  jenisPotong: string | null;
  adaNpwp: boolean;
  hutang: number;
  dasarPotong: number;
  dibayar: number;
  sisa: number;
  langkah: BarisHutangJasa[];
};

export type OpsiHutangJasa = {
  /** Hanya langkah pemasok ini. */
  supplierId?: string;
  /** Hanya WO ini (tes di basis data bersama memakai cakupan ini). */
  woIds?: string[];
  /** Buang langkah yang sisanya nol (lunas). Bawaan false. */
  hanyaBersisa?: boolean;
};

const NOL = new Decimal(0);
const rp = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/**
 * Hutang jasa produksi per pemasok, per langkah WO.
 *
 * Hutang jasa lahir di jurnal penerimaan barang jadi (CR hutang usaha =
 * `FGReceipt.serviceCost`). Penerimaan SEBELUM ongkos jahit masuk HPP
 * (`serviceCost` null) tidak pernah menjurnal hutang jasa, jadi pcs-nya tidak
 * dihitung di sini (tidak ada backfill). Per WO: Σ hutang semua langkahnya =
 * Σ `serviceCost` penerimaannya, persis (lihat `bagiHutangJasaPerLangkah`).
 *
 * Dibayar = Σ `SupplierPaymentAllocation.amount` ber-`targetType` "WO_STEP"
 * dan `targetId` = id langkah, dari `SupplierPayment` yang tidak berstatus
 * CANCELLED. Jumlah alokasi dibaca sebagai bagian BRUTO hutang yang
 * diselesaikan (sebelum PPh dipotong).
 */
export async function daftarHutangJasa(opsi: OpsiHutangJasa = {}, klien: Klien = prisma): Promise<HutangJasaPemasok[]> {
  const where: Prisma.WorkOrderWhereInput = {
    receipts: { some: { serviceCost: { not: null } } },
    ...(opsi.woIds ? { id: { in: opsi.woIds } } : {}),
    ...(opsi.supplierId ? { steps: { some: { supplierId: opsi.supplierId } } } : {}),
  };
  const wos = await klien.workOrder.findMany({
    where,
    orderBy: { docNumber: "asc" },
    select: {
      id: true,
      docNumber: true,
      receipts: { select: { qtyAccepted: true, serviceCost: true } },
      steps: {
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, stepName: true, supplierId: true, servicePrice: true, servicePpnIncluded: true, supplier: { select: { isPkp: true } } },
      },
    },
  });
  if (wos.length === 0) return [];
  const pengaturan = await bacaPengaturanPpn(klien);

  const baris: BarisHutangJasa[] = [];
  for (const wo of wos) {
    let qtyLama = NOL;
    let qtySemua = NOL;
    let tercatat = NOL;
    for (const r of wo.receipts) {
      const q = new Decimal(r.qtyAccepted.toString());
      qtySemua = qtySemua.plus(q);
      if (r.serviceCost == null) qtyLama = qtyLama.plus(q);
      else tercatat = tercatat.plus(r.serviceCost.toString());
    }
    const hitungan = wo.steps.map((s) => {
      const langkah = {
        id: s.id,
        supplierId: s.supplierId,
        servicePrice: s.servicePrice.toString(),
        servicePpnIncluded: s.servicePpnIncluded,
        pemasokPkp: s.supplier.isPkp,
      };
      const a = nilaiJasaKumulatif(langkah, qtyLama, pengaturan);
      const b = nilaiJasaKumulatif(langkah, qtySemua, pengaturan);
      return { tagihan: b.tagihan.minus(a.tagihan), dpp: b.dpp.minus(a.dpp) };
    });
    const bagian = bagiHutangJasaPerLangkah(tercatat, hitungan);
    wo.steps.forEach((s, i) => {
      if (opsi.supplierId && s.supplierId !== opsi.supplierId) return;
      const { hutang, dasarPotong } = bagian[i];
      baris.push({
        stepId: s.id,
        woId: wo.id,
        woDocNumber: wo.docNumber,
        urutan: s.sequence,
        namaLangkah: s.stepName,
        supplierId: s.supplierId,
        hargaPerPcs: Number(s.servicePrice),
        hargaTermasukPpn: s.servicePpnIncluded,
        qtyTerhutang: qtySemua.minus(qtyLama).toNumber(),
        hutang: rp(hutang),
        dasarPotong: rp(dasarPotong),
        ppn: rp(hutang.minus(dasarPotong)),
        dibayar: 0,
        sisa: rp(hutang),
      });
    });
  }
  if (baris.length === 0) return [];

  const alokasi = await klien.supplierPaymentAllocation.findMany({
    where: {
      targetType: TARGET_ALOKASI_LANGKAH_WO,
      targetId: { in: baris.map((b) => b.stepId) },
      payment: { status: { not: "CANCELLED" } },
    },
    select: { targetId: true, amount: true },
  });
  const dibayarPerLangkah = new Map<string, Decimal>();
  for (const a of alokasi) {
    if (!a.targetId) continue;
    dibayarPerLangkah.set(a.targetId, (dibayarPerLangkah.get(a.targetId) ?? NOL).plus(a.amount.toString()));
  }
  for (const b of baris) {
    const dibayar = dibayarPerLangkah.get(b.stepId) ?? NOL;
    b.dibayar = rp(dibayar);
    b.sisa = rp(new Decimal(b.hutang).minus(dibayar));
  }

  const tampil = opsi.hanyaBersisa ? baris.filter((b) => Math.abs(b.sisa) >= 0.005) : baris;
  if (tampil.length === 0) return [];
  const pemasok = await klien.supplier.findMany({
    where: { id: { in: [...new Set(tampil.map((b) => b.supplierId))] } },
    select: { id: true, code: true, name: true, taxWithholding: true, hasNpwp: true },
  });
  const perPemasok = new Map<string, HutangJasaPemasok>();
  for (const p of pemasok) {
    perPemasok.set(p.id, {
      supplierId: p.id,
      kodePemasok: p.code,
      namaPemasok: p.name,
      jenisPotong: p.taxWithholding,
      adaNpwp: p.hasNpwp,
      hutang: 0,
      dasarPotong: 0,
      dibayar: 0,
      sisa: 0,
      langkah: [],
    });
  }
  const sen = (n: number) => Math.round(n * 100);
  for (const b of tampil) {
    const g = perPemasok.get(b.supplierId);
    if (!g) continue;
    g.langkah.push(b);
    g.hutang = (sen(g.hutang) + sen(b.hutang)) / 100;
    g.dasarPotong = (sen(g.dasarPotong) + sen(b.dasarPotong)) / 100;
    g.dibayar = (sen(g.dibayar) + sen(b.dibayar)) / 100;
    g.sisa = (sen(g.sisa) + sen(b.sisa)) / 100;
  }
  return [...perPemasok.values()]
    .filter((g) => g.langkah.length > 0)
    .sort((a, b) => a.namaPemasok.localeCompare(b.namaPemasok, "id"));
}

// Bukan aksi server — pembaca untuk `receiveFG` (di dalam transaksinya) dan
// pratinjau layar Terima barang jadi (lewat aksi berpagar di
// app/actions/production.ts). KHUSUS SERVER: menarik Prisma; komponen klien
// hanya boleh `import type` dari berkas ini.

import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "@elorae/db";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bagianBahanPenerimaan, type DasarBiayaPenerimaan } from "./biaya-penerimaan";
import { nilaiBahanKembaliWo } from "./kembali-bahan-writer";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Dasar biaya penerimaan barang jadi berikutnya untuk satu WO, dibaca dari
 * DOKUMEN: pengeluaran bahan, bahan yang kembali, penerimaan sebelumnya
 * (bagian bahannya, bukan `totalCostValue`), langkah jasa, biaya tambahan per
 * pcs, dan pengaturan PPN. `receiveFG` memanggilnya di dalam transaksinya,
 * jadi penerimaan serentak konflik dan diulang dengan dasar yang baru.
 */
export async function bacaDasarBiayaPenerimaan(klien: Klien, woId: string): Promise<DasarBiayaPenerimaan | null> {
  const wo = await klien.workOrder.findUnique({
    where: { id: woId },
    select: {
      plannedQty: true,
      hppAdditionalCost: true,
      issues: { select: { totalCost: true } },
      receipts: { select: { qtyReceived: true, qtyAccepted: true, materialCost: true, totalCostValue: true } },
      steps: {
        orderBy: { sequence: "asc" },
        select: { id: true, supplierId: true, servicePrice: true, servicePpnIncluded: true, supplier: { select: { isPkp: true, name: true } } },
      },
    },
  });
  if (!wo) return null;

  const keluar = wo.issues.reduce((s, i) => s.plus(i.totalCost.toString()), new Decimal(0));
  const kembali = await nilaiBahanKembaliWo(klien, woId);
  const pengaturanPpn = await bacaPengaturanPpn(klien);

  return {
    // Bahan yang sudah kembali ke gudang tidak ikut dipikul barang jadi.
    totalBiayaBahan: Decimal.max(0, keluar.minus(kembali)).toString(),
    qtyRencana: wo.plannedQty.toString(),
    bahanSudahDibebankan: wo.receipts.reduce((s, r) => s.plus(bagianBahanPenerimaan(r)), new Decimal(0)).toString(),
    sudahDiterima: wo.receipts.reduce((s, r) => s.plus(r.qtyReceived.toString()), new Decimal(0)).toString(),
    sudahLolos: wo.receipts.reduce((s, r) => s.plus(r.qtyAccepted.toString()), new Decimal(0)).toString(),
    langkah: wo.steps.map((l) => ({
      id: l.id,
      supplierId: l.supplierId,
      servicePrice: l.servicePrice.toString(),
      servicePpnIncluded: l.servicePpnIncluded,
      // Pemasok bukan PKP tidak memungut PPN jasa (`nilaiJasaKumulatif`); null = belum diisi (peringatan di layar terima).
      pemasokPkp: l.supplier.isPkp,
      namaPemasok: l.supplier.name,
    })),
    biayaTambahanPerPcs: wo.hppAdditionalCost == null ? null : wo.hppAdditionalCost.toString(),
    pengaturanPpn,
  };
}

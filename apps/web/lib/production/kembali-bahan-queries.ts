// Bukan aksi server: pembaca ringkasan bahan WO. Pemagarnya `getBahanWo`
// di app/actions/production.ts.

import { Decimal } from "decimal.js";
import { prisma } from "@elorae/db";
import { bacaSisaBahanWo, riwayatKembaliBahan, type BarisRiwayatKembali } from "./kembali-bahan-writer";

export type BarisBahanWo = {
  itemId: string;
  nama: string;
  sku: string;
  satuan: string;
  /** Kebutuhan per pcs dari BOM (null bila barang tidak di rencana). */
  perPcs: number | null;
  /** Susut % dari BOM. */
  susutPersen: number | null;
  /** Kebutuhan total seluruh WO (rencana). */
  rencana: number | null;
  /** Dari dokumen pengeluaran bahan. */
  keluar: number;
  /** Dari penyesuaian `WO_MATERIAL_RETURN`. */
  kembali: number;
  /** Masih di CMT = keluar − kembali. */
  diCmt: number;
};

export type RingkasanBahanWo = {
  baris: BarisBahanWo[];
  riwayat: Array<BarisRiwayatKembali & { nama: string; satuan: string }>;
  /** Ada bahan yang masih di CMT (penghalang pembatalan). */
  adaDiCmt: boolean;
};

function angka(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Satu tabel bahan WO: rencana (BOM) di samping keluar/kembali/di CMT dari
 * dokumen. Barang yang keluar tetapi tidak di rencana (bahan tambahan) tetap
 * tampil, tanpa angka rencana.
 */
export async function ringkasanBahanWo(woId: string): Promise<RingkasanBahanWo | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { consumptionPlan: true, issues: { select: { items: true } } },
  });
  if (!wo) return null;

  let rencanaMentah: unknown = wo.consumptionPlan;
  if (typeof rencanaMentah === "string") {
    try {
      rencanaMentah = JSON.parse(rencanaMentah);
    } catch {
      rencanaMentah = [];
    }
  }
  const rencana = (Array.isArray(rencanaMentah) ? rencanaMentah : []) as Array<Record<string, unknown> | null>;
  const sisa = await bacaSisaBahanWo(prisma, woId, wo.issues);
  const sisaPer = new Map(sisa.map((s) => [s.itemId, s]));

  const urutan: string[] = [];
  for (const p of rencana) {
    const id = p?.itemId ?? p?.item_id;
    if (id != null && id !== "" && !urutan.includes(String(id))) urutan.push(String(id));
  }
  for (const s of sisa) if (!urutan.includes(s.itemId)) urutan.push(s.itemId);

  const barang = urutan.length
    ? await prisma.item.findMany({
        where: { id: { in: urutan } },
        select: { id: true, sku: true, nameId: true, uom: { select: { code: true } } },
      })
    : [];
  const barangPer = new Map(barang.map((b) => [b.id, b]));
  const nol = new Decimal(0);

  const baris: BarisBahanWo[] = urutan.map((itemId) => {
    const p = rencana.find((r) => String(r?.itemId ?? r?.item_id ?? "") === itemId) ?? null;
    const s = sisaPer.get(itemId);
    const b = barangPer.get(itemId);
    return {
      itemId,
      nama: b?.nameId ?? String(p?.itemName ?? p?.item_name ?? itemId),
      sku: b?.sku ?? "",
      satuan: b?.uom?.code ?? String(p?.uomCode ?? p?.uom_code ?? ""),
      perPcs: p ? angka(p.qtyRequired ?? p.qty_required) : null,
      susutPersen: p ? angka(p.wastePercent ?? p.waste_percent) : null,
      rencana: p ? angka(p.plannedQty ?? p.planned_qty) : null,
      keluar: (s?.keluar ?? nol).toNumber(),
      kembali: (s?.kembali ?? nol).toNumber(),
      diCmt: (s?.sisa ?? nol).toNumber(),
    };
  });

  const riwayat = (await riwayatKembaliBahan(woId)).map((r) => {
    const b = barangPer.get(r.itemId);
    return { ...r, nama: b?.nameId ?? r.itemId, satuan: b?.uom?.code ?? "" };
  });

  return { baris, riwayat, adaDiCmt: baris.some((b) => b.diCmt > 0.005) };
}

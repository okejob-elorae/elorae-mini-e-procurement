import { prisma, type Prisma } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bacaLunasPemasokGrnTanpaPo, bacaLunasPemasokPerGrn, keadaanBayarPo } from "@/lib/purchasing/pembayaran-hutang-queries";
import { daftarHutangJasa } from "@/lib/production/hutang-jasa-queries";
import type { BarisSelisihHarga } from "./koreksi-utang-queries";

/*
 * Konteks kartu/daftar keputusan selisih harga: utang dan yang sudah dibayar atas penerimaannya (kalimat
 * lebih bayar untuk invoice lebih rendah, P53), PO yang ditandai lunas lewat tombol lama (peringatan
 * sebelum Terima), dan peran jurnal yang belum dipetakan (spanduk sebelum tombol Terima ditekan — tanpa
 * pemetaan `PURCHASE_PRICE_VARIANCE` setiap Terima yang barangnya sudah keluar ditolak, dan penerimaannya
 * tetap tidak bisa dibayar). KHUSUS SERVER.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type KonteksKoreksi = { utangSen: number | null; dibayarSen: number | null; poDitandaiLunas: boolean };

export async function konteksKoreksi(rows: readonly BarisSelisihHarga[], db: Db = prisma): Promise<Map<string, KonteksKoreksi>> {
  const out = new Map<string, KonteksKoreksi>();
  const grnRows = rows.filter((r) => r.sourceType === "GRN");
  const stepRows = rows.filter((r) => r.sourceType === "WO_STEP");
  if (grnRows.length > 0) {
    const grns = await db.gRN.findMany({ where: { id: { in: grnRows.map((r) => r.sourceId) } }, select: { id: true, poId: true } });
    const poIds = [...new Set(grns.flatMap((g) => (g.poId ? [g.poId] : [])))];
    const [perPo, tanpaPo, pos] = await Promise.all([
      bacaLunasPemasokPerGrn(poIds, db),
      bacaLunasPemasokGrnTanpaPo(grns.filter((g) => !g.poId).map((g) => g.id), db),
      poIds.length ? db.purchaseOrder.findMany({ where: { id: { in: poIds }, paidAt: { not: null } }, select: { id: true } }) : Promise.resolve([] as Array<{ id: string }>),
    ]);
    const keadaan = pos.length ? await keadaanBayarPo(pos.map((p) => p.id), db) : new Map();
    const tombolLama = new Set(pos.filter((p) => !keadaan.get(p.id)?.adaAlokasiDokumen).map((p) => p.id));
    const poPer = new Map(grns.map((g) => [g.id, g.poId]));
    for (const r of grnRows) {
      const l = perPo.get(r.sourceId) ?? tanpaPo.get(r.sourceId);
      const po = poPer.get(r.sourceId) ?? null;
      out.set(r.id, { utangSen: l?.hutangSen ?? null, dibayarSen: l?.lunasPemasokSen ?? null, poDitandaiLunas: po != null && tombolLama.has(po) });
    }
  }
  if (stepRows.length > 0) {
    const steps = await db.workOrderStep.findMany({ where: { id: { in: stepRows.map((r) => r.sourceId) } }, select: { id: true, woId: true } });
    const per = new Map<string, { hutang: number; dibayar: number }>();
    for (const p of await daftarHutangJasa({ woIds: [...new Set(steps.map((s) => s.woId))] }, db)) for (const l of p.langkah) per.set(l.stepId, { hutang: l.hutang, dibayar: l.dibayar });
    for (const r of stepRows) {
      const l = per.get(r.sourceId);
      out.set(r.id, { utangSen: l ? Math.round(l.hutang * 100) : null, dibayarSen: l ? Math.round(l.dibayar * 100) : null, poDitandaiLunas: false });
    }
  }
  return out;
}

/** Peran jurnal keputusan Terima yang belum dipetakan (hanya yang selalu atau sering dipakai). */
export async function peranKoreksiBelumDipetakan(db: Db = prisma): Promise<string[]> {
  const hasil: string[] = [];
  for (const peran of ["AP", "PURCHASE_PRICE_VARIANCE"] as const) {
    try {
      await resolveAccount(peran, db);
    } catch (e) {
      if (e instanceof UnmappedRoleError) hasil.push(peran);
      else throw e;
    }
  }
  return hasil;
}

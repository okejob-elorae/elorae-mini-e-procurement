import { prisma, type Prisma } from "@elorae/db";
import { daftarHutangJasa, type BarisHutangJasa } from "@/lib/production/hutang-jasa-queries";
import { bacaLunasPemasokGrnTanpaPo, bacaLunasPemasokPerGrn } from "@/lib/purchasing/pembayaran-hutang-queries";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { billBookedShares } from "./billable";
import { STATUS_KOREKSI_UTANG } from "./koreksi-utang-aturan";
import { SUMBER_KOREKSI } from "./koreksi-utang-queries";

type Db = Prisma.TransactionClient | typeof prisma;

const cents = (n: number | Prisma.Decimal | string) => Math.round(Number(n) * 100);

export type StepOverpaidByVoid = {
  woStepId: string;
  /** "WO-… step 1 Jahit", for the refusal. */
  label: string;
  /** What the step would still owe once this bill's booking is reversed. */
  payableAfterCents: number;
  /** What was paid on it: Supplier payments plus old vendor payments, as the payable sub-ledger reads it. */
  paidCents: number;
};

/**
 * The WO steps that voiding this bill would leave paid above their payable, counting ONLY the old-CMT
 * booking (`VENDOR_BILL` journal, `billBookedShares`). Legacy, kept as it is: the complete check with
 * accepted price-difference corrections is `penerimaanLebihBayarJikaDibatalkan`, which the void and the
 * bill page use.
 */
export async function stepsOverpaidByVoid(db: Db, billId: string): Promise<StepOverpaidByVoid[]> {
  const lines = await db.vendorBillLine.findMany({
    where: { billId, woStepId: { not: null } },
    select: { woStepId: true, woStep: { select: { woId: true } } },
  });
  const stepIds = [...new Set(lines.flatMap((l) => (l.woStepId ? [l.woStepId] : [])))];
  if (stepIds.length === 0) return [];
  const own = new Map<string, number>();
  for (const s of await billBookedShares(db, stepIds)) {
    if (s.billId === billId && s.cents > 0) own.set(s.woStepId, (own.get(s.woStepId) ?? 0) + s.cents);
  }
  if (own.size === 0) return [];

  const woIds = [...new Set(lines.flatMap((l) => (l.woStep ? [l.woStep.woId] : [])))];
  const ledger = new Map<string, BarisHutangJasa>();
  for (const p of await daftarHutangJasa({ woIds }, db)) for (const l of p.langkah) ledger.set(l.stepId, l);

  const out: StepOverpaidByVoid[] = [];
  for (const [woStepId, booked] of own) {
    const l = ledger.get(woStepId);
    if (!l) continue;
    const payableAfterCents = cents(l.hutang) - booked;
    const paidCents = cents(l.dibayar);
    if (paidCents > 0 && paidCents > payableAfterCents) {
      out.push({ woStepId, label: `${l.woDocNumber} step ${l.urutan}${l.namaLangkah ? ` ${l.namaLangkah}` : ""}`, payableAfterCents, paidCents });
    }
  }
  return out;
}

export type PenerimaanLebihBayar = { kunci: string; label: string; payableAfterSen: number; paidSen: number };

/**
 * The receipts (WO steps and GRNs) that voiding this bill would leave paid above their payable — the
 * only way a void can pull a payable out from under a payment. Voiding reverses exactly what the bill
 * booked: the old-CMT `VENDOR_BILL` journal on its steps, and its ACCEPTED price-difference corrections
 * (P27/P49). ONE check per receipt over both, so a combined overpayment cannot slip past two separate
 * checks: payable after = payable now − this bill's own booking − this bill's own accepted correction.
 * Refused when what was paid on it exceeds that. Cheap path: a bill with neither books nothing.
 * `voidVendorBill` reads it inside its serializable transaction; the bill page reads it to say why the
 * void is withheld.
 */
export async function penerimaanLebihBayarJikaDibatalkan(db: Db, billId: string): Promise<PenerimaanLebihBayar[]> {
  const [jurnal, koreksi] = await Promise.all([
    db.journal.count({ where: { sourceType: "VENDOR_BILL", sourceId: billId, status: "POSTED" } }),
    db.supplierPayableCorrection.findMany({
      where: { billId, status: STATUS_KOREKSI_UTANG.DITERIMA },
      select: { sourceType: true, sourceId: true, amount: true },
    }),
  ]);
  if (jurnal === 0 && koreksi.length === 0) return [];

  const milik = new Map<string, number>();
  const tambah = (k: string, n: number) => milik.set(k, (milik.get(k) ?? 0) + n);
  for (const k of koreksi) tambah(kunciDokumenHutang(k.sourceType, k.sourceId), cents(k.amount));

  const lines = await db.vendorBillLine.findMany({ where: { billId, woStepId: { not: null } }, select: { woStepId: true, woStep: { select: { woId: true } } } });
  const stepIds = [...new Set([...lines.flatMap((l) => (l.woStepId ? [l.woStepId] : [])), ...koreksi.filter((k) => k.sourceType === SUMBER_KOREKSI.WO_STEP).map((k) => k.sourceId)])];
  if (jurnal > 0 && stepIds.length > 0) {
    for (const s of await billBookedShares(db, stepIds)) if (s.billId === billId && s.cents !== 0) tambah(kunciDokumenHutang("WO_STEP", s.woStepId), s.cents);
  }

  const out: PenerimaanLebihBayar[] = [];
  if (stepIds.length > 0) {
    const woIds = new Set(lines.flatMap((l) => (l.woStep ? [l.woStep.woId] : [])));
    for (const s of await db.workOrderStep.findMany({ where: { id: { in: stepIds } }, select: { woId: true } })) woIds.add(s.woId);
    for (const p of await daftarHutangJasa({ woIds: [...woIds] }, db)) {
      for (const l of p.langkah) {
        const kunci = kunciDokumenHutang("WO_STEP", l.stepId);
        const own = milik.get(kunci);
        if (own == null || own <= 0) continue;
        const payableAfterSen = cents(l.hutang) - own;
        const paidSen = cents(l.dibayar);
        if (paidSen > 0 && paidSen > payableAfterSen) {
          out.push({ kunci, label: `${l.woDocNumber} step ${l.urutan}${l.namaLangkah ? ` ${l.namaLangkah}` : ""}`, payableAfterSen, paidSen });
        }
      }
    }
  }

  const grnIds = koreksi.filter((k) => k.sourceType === SUMBER_KOREKSI.GRN).map((k) => k.sourceId);
  if (grnIds.length > 0) {
    const grns = await db.gRN.findMany({ where: { id: { in: grnIds } }, select: { id: true, docNumber: true, poId: true } });
    const poIds = [...new Set(grns.flatMap((g) => (g.poId ? [g.poId] : [])))];
    const [perPo, tanpaPo] = await Promise.all([
      bacaLunasPemasokPerGrn(poIds, db),
      bacaLunasPemasokGrnTanpaPo(grns.filter((g) => !g.poId).map((g) => g.id), db),
    ]);
    for (const g of grns) {
      const kunci = kunciDokumenHutang("GRN", g.id);
      const own = milik.get(kunci);
      const l = perPo.get(g.id) ?? tanpaPo.get(g.id);
      if (own == null || own <= 0 || !l) continue;
      const payableAfterSen = l.hutangSen - own;
      if (l.lunasPemasokSen > 0 && l.lunasPemasokSen > payableAfterSen) out.push({ kunci, label: g.docNumber, payableAfterSen, paidSen: l.lunasPemasokSen });
    }
  }
  return out;
}

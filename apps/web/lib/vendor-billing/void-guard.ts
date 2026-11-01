import { prisma, type Prisma } from "@elorae/db";
import { daftarHutangJasa, type BarisHutangJasa } from "@/lib/production/hutang-jasa-queries";
import { billBookedShares } from "./billable";

type Db = Prisma.TransactionClient | typeof prisma;

const cents = (n: number) => Math.round(n * 100);

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
 * The WO steps that voiding this bill would leave paid above their payable — the only way a void can
 * pull a payable out from under a payment. Voiding mirrors just the journal the bill posted
 * (`bill-journal.ts`): a PO line, and step work a finished-goods receipt booked, post nothing, so
 * voiding them moves no payable, whatever Supplier payments paid on those receipts — that payment
 * simply reads against the source's other bills, or none, and a corrected invoice can be entered. A
 * bill that booked old CMT itself (a standing `VENDOR_BILL` journal, `billBookedShares`) takes that
 * payable off its steps when voided; where what was paid on a step (`daftarHutangJasa` `dibayar`) is
 * more than what the step would still owe, AP would go below zero with nothing on screen to explain
 * it. `voidVendorBill` reads this inside its serializable transaction, so a supplier payment saved at
 * the same time cannot slip past it; the bill page reads it to say why the void is withheld.
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
    // A live bill on the step always puts its WO in the sub-ledger; nothing to weigh without it.
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

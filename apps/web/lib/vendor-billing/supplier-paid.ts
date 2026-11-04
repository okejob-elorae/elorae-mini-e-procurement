import { prisma, type Prisma } from "@elorae/db";
import { SARING_PEMBAYARAN_DOKUMEN } from "@/lib/purchasing/pembayaran-dokumen-po";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { bacaLunasPemasokGrnTanpaPo, bacaLunasPemasokPerGrn } from "@/lib/purchasing/pembayaran-hutang-queries";
import { daftarHutangJasa } from "@/lib/production/hutang-jasa-queries";
import { bagiLunasKeBaris, grnLineKey, hutangPerKunciGrn, lineRooms, readGrnLinesDetail, urutkanInvoice } from "./bill-paid-rule";
import { STATUS_KOREKSI_UTANG } from "./koreksi-utang-aturan";
import { deriveBillStatus, type VendorBillStatus } from "./status";

/*
 * What Supplier payments → Pay has paid on vendor bills. Since 2026-11-01 that page is the only
 * payment path (owner decision: Vendor Billing records and matches invoices, it no longer takes
 * payments), so a bill's stored `paidAmount`/`status` — written by the old vendor payment writers
 * only — would leave a bill paid there reading "Unpaid" for good. The Vendor Billing screens read
 * both paths through `withSupplierPaid` instead; the stored columns keep meaning "paid through
 * Vendor Billing", so nothing is counted twice.
 *
 * The rule is `bill-paid-rule.ts`, VALUE-based per receipt: what Supplier payments settled on a GRN
 * or a WO step goes to the live bill lines naming it, oldest INVOICE DATE first (P29), each line up to
 * its recorded payable (received pieces × the receipt's recorded payable per piece, plus its own
 * waiting or accepted price-difference correction). `rincianLunasPerSumber` is the ONE reader, shared
 * by the bill status and the "Bayar per invoice" picker (`invoice-bayar-queries.ts`). A legacy PO_ITEM
 * line names no receipt (`grnId` null) and covers nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const cents = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** The pool key of a WO step (kept for callers that key step pools this way). */
export const stepSource = (woStepId: string) => `WO_STEP:${woStepId}`;

export type BarisLunasSumber = {
  billId: string;
  lineId: string;
  /** Position in `urutkanInvoice` order on this receipt (0 = paid first). */
  urutan: number;
  /** The line's recorded payable, PPN included (cents). */
  tercatatSen: number;
  /** The line's invoice amount still open after its share of old vendor payments (cents). */
  ruangSen: number;
  /** What it took of the receipt's settled cents. */
  diambilSen: number;
  /** That, read back in invoice terms. */
  dibayarInvoiceSen: number;
  koreksi: { id: string; status: string; jumlahSen: number } | null;
};

export type RincianLunasSumber = {
  /** What Supplier payments settled on the receipt (cents). */
  lunasSen: number;
  /** Its recorded payable without corrections (cents). */
  hutangTanpaKoreksiSen: number;
  /** Recorded payable per piece (cents, may be fractional): per GRN key, or "" for a WO step. */
  perPotongSen: Map<string, number>;
  /** Pieces received per GRN key (or "" for a WO step: its booked pieces). */
  qtyPerKunci: Map<string, number>;
  baris: BarisLunasSumber[];
};

/**
 * The value-based paid rule per receipt, keyed `kunciDokumenHutang("GRN" | "WO_STEP", id)`. Every live
 * GRN_ITEM / WO_STEP line on a scoped receipt is read, whichever bill it is on, because a receipt's
 * settled cents are shared by all of them in invoice-date order.
 */
export async function rincianLunasPerSumber(db: Db, scope: { grnIds: string[]; woStepIds: string[] }): Promise<Map<string, RincianLunasSumber>> {
  const grnIds = [...new Set(scope.grnIds)];
  const stepIds = [...new Set(scope.woStepIds)];
  const out = new Map<string, RincianLunasSumber>();
  if (grnIds.length === 0 && stepIds.length === 0) return out;

  for (const ids of chunk(grnIds, 500)) {
    const grns = await db.gRN.findMany({ where: { id: { in: ids } }, select: { id: true, poId: true, items: true, ppnAmount: true, totalAmount: true } });
    const [perPo, tanpaPo] = await Promise.all([
      bacaLunasPemasokPerGrn([...new Set(grns.flatMap((g) => (g.poId ? [g.poId] : [])))], db),
      bacaLunasPemasokGrnTanpaPo(grns.filter((g) => !g.poId).map((g) => g.id), db),
    ]);
    for (const g of grns) {
      const lunas = perPo.get(g.id) ?? tanpaPo.get(g.id);
      const hutangTanpaKoreksiSen = lunas ? lunas.hutangTanpaKoreksiSen : cents(g.totalAmount) + cents(g.ppnAmount);
      const detail = readGrnLinesDetail(g.items);
      const perKunci = hutangPerKunciGrn({
        baris: detail.map((d) => ({ key: d.key, nilaiSen: cents(d.totalCost), ppnMasukan: d.ppnMasukan })),
        ppnSen: cents(g.ppnAmount),
        hutangSen: hutangTanpaKoreksiSen,
      });
      const qtyPerKunci = new Map<string, number>();
      for (const d of detail) qtyPerKunci.set(d.key, (qtyPerKunci.get(d.key) ?? 0) + d.qty);
      const perPotongSen = new Map<string, number>();
      for (const [k, q] of qtyPerKunci) perPotongSen.set(k, q > 0 ? (perKunci.get(k) ?? 0) / q : 0);
      out.set(kunciDokumenHutang("GRN", g.id), { lunasSen: lunas?.lunasPemasokSen ?? 0, hutangTanpaKoreksiSen, perPotongSen, qtyPerKunci, baris: [] });
    }
  }

  if (stepIds.length > 0) {
    const woIds = new Set<string>();
    for (const ids of chunk(stepIds, 500)) {
      for (const s of await db.workOrderStep.findMany({ where: { id: { in: ids } }, select: { woId: true } })) woIds.add(s.woId);
    }
    const ledger = new Map<string, { hutangSen: number; qty: number }>();
    for (const ids of chunk([...woIds], 500)) {
      for (const p of await daftarHutangJasa({ woIds: ids }, db)) {
        for (const l of p.langkah) ledger.set(l.stepId, { hutangSen: cents(l.hutangTanpaKoreksi), qty: l.qtyTerhutang });
      }
    }
    const paid = new Map<string, number>();
    for (const ids of chunk(stepIds, 500)) {
      const rows = await db.supplierPaymentAllocation.findMany({
        where: { targetType: "WO_STEP", targetId: { in: ids }, payment: SARING_PEMBAYARAN_DOKUMEN },
        select: { targetId: true, amount: true },
      });
      for (const r of rows) if (r.targetId) paid.set(r.targetId, (paid.get(r.targetId) ?? 0) + cents(r.amount));
    }
    for (const id of stepIds) {
      const b = ledger.get(id) ?? { hutangSen: 0, qty: 0 };
      out.set(kunciDokumenHutang("WO_STEP", id), {
        lunasSen: paid.get(id) ?? 0,
        hutangTanpaKoreksiSen: b.hutangSen,
        perPotongSen: new Map([["", b.qty > 0 ? b.hutangSen / b.qty : 0]]),
        qtyPerKunci: new Map([["", b.qty]]),
        baris: [],
      });
    }
  }

  const or: Prisma.VendorBillLineWhereInput[] = [];
  if (grnIds.length > 0) or.push({ grnId: { in: grnIds } });
  if (stepIds.length > 0) or.push({ woStepId: { in: stepIds } });
  const bills = await db.vendorBill.findMany({
    where: { status: { not: "VOID" }, lines: { some: { OR: or } } },
    select: {
      id: true,
      billDate: true,
      createdAt: true,
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      lines: { orderBy: { id: "asc" }, select: { id: true, qty: true, amount: true, grnId: true, itemId: true, variantSku: true, woStepId: true } },
    },
  });
  const lineIds = bills.flatMap((b) => b.lines.map((l) => l.id));
  const koreksi = new Map<string, { id: string; status: string; jumlahSen: number }>();
  for (const ids of chunk(lineIds, 500)) {
    for (const k of await db.supplierPayableCorrection.findMany({ where: { billLineId: { in: ids } }, select: { id: true, billLineId: true, status: true, amount: true } })) {
      koreksi.set(k.billLineId, { id: k.id, status: k.status, jumlahSen: cents(k.amount) });
    }
  }

  const calon = new Map<string, Array<Omit<BarisLunasSumber, "urutan" | "diambilSen" | "dibayarInvoiceSen">>>();
  for (const b of urutkanInvoice(bills)) {
    const vendorPaid = b.allocations.reduce((s, a) => s + cents(a.amount), 0);
    const amounts = b.lines.map((l) => Math.max(0, cents(l.amount)));
    const rooms = lineRooms(vendorPaid, amounts);
    b.lines.forEach((l, i) => {
      const kunci = l.grnId ? kunciDokumenHutang("GRN", l.grnId) : l.woStepId ? kunciDokumenHutang("WO_STEP", l.woStepId) : null;
      const sumber = kunci ? out.get(kunci) : undefined;
      if (!kunci || !sumber) return;
      const frac = amounts[i] > 0 ? rooms[i] / amounts[i] : 1;
      const kunciBarang = l.grnId && l.itemId ? grnLineKey(l.itemId, l.variantSku) : "";
      const perPotong = sumber.perPotongSen.get(kunciBarang) ?? 0;
      const k = koreksi.get(l.id) ?? null;
      const ikut = k && (k.status === STATUS_KOREKSI_UTANG.MENUNGGU || k.status === STATUS_KOREKSI_UTANG.DITERIMA) ? k.jumlahSen : 0;
      const tercatatSen = Math.round(Number(l.qty) * frac * perPotong + ikut * frac);
      const daftar = calon.get(kunci) ?? [];
      daftar.push({ billId: b.id, lineId: l.id, tercatatSen, ruangSen: rooms[i], koreksi: k });
      calon.set(kunci, daftar);
    });
  }
  for (const [kunci, daftar] of calon) {
    const sumber = out.get(kunci)!;
    const bagi = bagiLunasKeBaris(sumber.lunasSen, daftar);
    sumber.baris = daftar.map((d, urutan) => ({ ...d, urutan, diambilSen: bagi.get(d.lineId)?.diambilSen ?? 0, dibayarInvoiceSen: bagi.get(d.lineId)?.dibayarInvoiceSen ?? 0 }));
  }
  return out;
}

/** Cents paid per bill through Supplier payments, and the bills with a price difference still waiting. */
async function supplierPaidRinci(db: Db, billIds: string[]): Promise<{ paid: Map<string, number>; menunggu: Set<string> }> {
  const wanted = new Set(billIds);
  const paid = new Map<string, number>();
  const menunggu = new Set<string>();
  if (wanted.size === 0) return { paid, menunggu };
  const grnIds = new Set<string>();
  const woStepIds = new Set<string>();
  for (const ids of chunk([...wanted], 500)) {
    const own = await db.vendorBillLine.findMany({ where: { billId: { in: ids }, bill: { status: { not: "VOID" } } }, select: { woStepId: true, grnId: true } });
    for (const l of own) {
      if (l.woStepId) woStepIds.add(l.woStepId);
      else if (l.grnId) grnIds.add(l.grnId);
    }
    for (const k of await db.supplierPayableCorrection.findMany({ where: { billId: { in: ids }, status: STATUS_KOREKSI_UTANG.MENUNGGU }, select: { billId: true } })) {
      menunggu.add(k.billId);
    }
  }
  if (grnIds.size === 0 && woStepIds.size === 0) return { paid, menunggu };
  const rinci = await rincianLunasPerSumber(db, { grnIds: [...grnIds], woStepIds: [...woStepIds] });
  for (const s of rinci.values()) {
    for (const b of s.baris) if (wanted.has(b.billId) && b.dibayarInvoiceSen > 0) paid.set(b.billId, (paid.get(b.billId) ?? 0) + b.dibayarInvoiceSen);
  }
  return { paid, menunggu };
}

/**
 * Cents Supplier payments have paid on each of the given live bills (`rincianLunasPerSumber`). A bill
 * nothing reached is absent; a voided bill never takes a share, so voiding one hands its share to the
 * next bill on the same receipt.
 */
export async function supplierPaidByBill(db: Db, billIds: string[]): Promise<Map<string, number>> {
  return (await supplierPaidRinci(db, billIds)).paid;
}

export type BillPaidInput = { id: string; total: number; paidAmount: number; status: VendorBillStatus };

export type BillPaidFigures = {
  /** Paid through both paths. */
  paidAmount: number;
  /** Paid through the old Vendor Billing payments (the stored `VendorBill.paidAmount`). */
  vendorPaidAmount: number;
  /** Paid through Supplier payments → Pay, on this bill's share of its receipts. */
  supplierPaidAmount: number;
  status: VendorBillStatus;
};

/**
 * Bill rows with what both payment paths paid on them, and the status that follows. A bill with a price
 * difference still waiting for the decision never reads PAID (P53: a lower invoice already covered by
 * the recorded payable still waits) — it reads PARTIAL until decided.
 */
export async function withSupplierPaid<T extends BillPaidInput>(rows: T[], db: Db = prisma): Promise<Array<T & BillPaidFigures>> {
  const { paid, menunggu } = await supplierPaidRinci(
    db,
    rows.filter((r) => r.status !== "VOID").map((r) => r.id)
  );
  return rows.map((r) => {
    const supplierPaidAmount = r.status === "VOID" ? 0 : (paid.get(r.id) ?? 0) / 100;
    const paidAmount = round2(r.paidAmount + supplierPaidAmount);
    let status: VendorBillStatus = r.status === "VOID" ? "VOID" : deriveBillStatus(r.total, paidAmount, false);
    if (status === "PAID" && menunggu.has(r.id)) status = "PARTIAL";
    return { ...r, vendorPaidAmount: r.paidAmount, supplierPaidAmount, paidAmount, status };
  });
}

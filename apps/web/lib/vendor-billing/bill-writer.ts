import { z } from "zod";
import type { Prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { grnBelumDiproses } from "@/lib/grn/grn-tanpa-po";
import { billedQtyByGrnLine, billedQtyByWoStep, returnedQtyByGrnLine, unbookedReceiptQtyByWo } from "./billable";
import { grnLineKey, grnLineSource, readGrnLinesDetail } from "./bill-paid-rule";
import { postVendorBillJournal, postVendorBillReversalJournal } from "./bill-journal";
import { selisihUtangBarisGrn, selisihUtangLangkah, type BagianPenerimaanJasa, type ModePpnGrn } from "./koreksi-utang-aturan";
import { batalkanKoreksiTagihan, buatKoreksiUtang, kodeTolakKoreksi, type BarisKoreksiBaru } from "./koreksi-utang-writer";
import type { NotifikasiKantor } from "./kabar-pemasok";
import { bukaLagiPermintaanTerdampak } from "./permintaan-invoice-writer";
import { penerimaanLebihBayarJikaDibatalkan } from "./void-guard";

/** A refusal the user can act on; its message is shown as-is. `code` names the refusal for a caller that branches on it. */
export class VendorBillError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

/*
 * An invoice line names the RECEIPT it bills (decision 2026-10-29: "admin MEMILIH penerimaan barang
 * mana saja yang ditagih invoice itu"): a GRN and one item key in it, or a WO step. PO_ITEM is refused:
 * the old shape named a PO item, not a receipt, and is never written again.
 */
const lineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("GRN_ITEM"),
    grnId: z.string().min(1),
    itemId: z.string().min(1),
    variantSku: z.string().trim().max(191).nullish(),
    qty: z.number().positive(),
    price: z.number().min(0),
  }),
  z.object({
    type: z.literal("WO_STEP"),
    sourceId: z.string().min(1),
    qty: z.number().positive(),
    price: z.number().min(0),
  }),
]);

const kunciBaris = (l: z.infer<typeof lineSchema>) =>
  l.type === "GRN_ITEM" ? `GRN_ITEM:${l.grnId}:${l.itemId}:${l.variantSku?.trim() ?? ""}` : `WO_STEP:${l.sourceId}`;

export const createVendorBillSchema = z
  .object({
    supplierId: z.string().min(1),
    vendorInvoiceNo: z.string().trim().min(1).max(64),
    billDate: z.coerce.date(),
    dueDate: z.coerce.date().nullish(),
    notes: z.string().trim().max(2000).nullish(),
    lines: z.array(lineSchema).min(1).max(200),
  })
  .refine((d) => new Set(d.lines.map(kunciBaris)).size === d.lines.length, {
    message: "Satu baris sumber hanya boleh sekali per tagihan",
    path: ["lines"],
  });

export type CreateVendorBillInput = z.input<typeof createVendorBillSchema>;

export function journalRefusal(res: Extract<GenerateAutoJournalResult, { ok: false }>): VendorBillError {
  if (res.code === "UNMAPPED_ROLE") return new VendorBillError(`Petakan akun untuk ${res.role} di Pemetaan Akun dulu`);
  return new VendorBillError(`Jurnal tagihan gagal diposting (${res.code})`);
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

type BarisBaru = Omit<Prisma.VendorBillLineUncheckedCreateInput, "billId"> & { koreksi: Omit<BarisKoreksiBaru, "billLineId"> | null };

/** Variants of finished-goods receipts as their MAIN ledger entries moved them in, per receipt. */
async function varianPenerimaanFg(tx: Prisma.TransactionClient, receiptIds: string[]): Promise<Map<string, Array<{ variantSku: string; porsi: number }>>> {
  const out = new Map<string, Array<{ variantSku: string; porsi: number }>>();
  if (receiptIds.length === 0) return out;
  const rows = await tx.stockLedgerEntry.findMany({
    where: { refType: "FGReceipt", refId: { in: receiptIds }, locationType: "MAIN", qty: { gt: 0 } },
    select: { refId: true, variantSku: true, qty: true },
  });
  for (const r of rows) {
    const list = out.get(r.refId) ?? [];
    const v = r.variantSku ?? "";
    const ada = list.find((x) => x.variantSku === v);
    if (ada) ada.porsi += Number(r.qty);
    else list.push({ variantSku: v, porsi: Number(r.qty) });
    out.set(r.refId, list);
  }
  return out;
}

/**
 * Saves a vendor bill against receipts of one supplier: GRN item keys (GRN_ITEM) and WO steps. The
 * caps and the supplier match are re-read inside the serializable transaction, with the named GRN rows
 * and their POs locked first, so two bills racing for the same remaining qty cannot both pass.
 *
 * A GRN row is billable only when PROCESSED: its PO not cancelled (or, without a PO, confirmed by the
 * admin — P51a), not declined by the owner, and not awaiting the owner's over-receive decision (only
 * that GRN; sibling GRNs of the same PO stay billable). A line may bill at most what that GRN brought in
 * under the key, less completed vendor returns naming it, less what live lines already bill.
 *
 * A GRN line posts nothing: the GRN booked its payable. A step line posts nothing for pieces a
 * finished-goods receipt booked; pieces from old receipts that booked none (`unbookedReceiptQtyByWo`)
 * are booked here (`bill-journal.ts`) at the invoice price, first come first served — legacy, kept as
 * it is and not extended.
 *
 * A price that differs from the receipt's recorded price — higher OR lower — creates a
 * SupplierPayableCorrection MENUNGGU for that line (P27, P53), and the whole receipt cannot be paid
 * until it is decided (P50). The invoice itself never creates a second payable (2026-10-29). Old-CMT
 * pieces get no correction: the bill journal books them at the invoice price.
 */
export async function createVendorBill(
  input: CreateVendorBillInput,
  userId: string,
): Promise<{ id: string; docNumber: string; koreksi: number; notifikasi: NotifikasiKantor | null }> {
  const data = createVendorBillSchema.parse(input);
  const grnLines = data.lines.filter((l): l is Extract<typeof l, { type: "GRN_ITEM" }> => l.type === "GRN_ITEM");
  const stepLines = data.lines.filter((l): l is Extract<typeof l, { type: "WO_STEP" }> => l.type === "WO_STEP");

  return runSerializable(
    async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId }, select: { paymentTermsDays: true, name: true } });
      if (!supplier) throw new VendorBillError("Supplier tidak ditemukan");
      // Unique among live bills only, so a voided bill's number can be entered again. The read
      // joins this serializable transaction, so two saves of one number cannot both pass.
      const clash = await tx.vendorBill.count({
        where: { supplierId: data.supplierId, vendorInvoiceNo: data.vendorInvoiceNo, status: { not: "VOID" } },
      });
      if (clash > 0) throw new VendorBillError("Nomor invoice vendor sudah dipakai untuk supplier ini");

      const pengaturan = await bacaPengaturanPpn(tx);
      const baru: BarisBaru[] = [];
      const poTerms: number[] = [];
      let unbookedAmount = 0;

      if (grnLines.length > 0) {
        const grnIds = [...new Set(grnLines.map((l) => l.grnId))].sort();
        // Lock the named GRNs (id order), then their POs, the lock updatePO takes before rebuilding items.
        for (const id of grnIds) await tx.$queryRaw`SELECT \`id\` FROM \`GRN\` WHERE \`id\` = ${id} FOR UPDATE`;
        const grns = await tx.gRN.findMany({
          where: { id: { in: grnIds } },
          select: {
            id: true,
            docNumber: true,
            grnDate: true,
            supplierId: true,
            poId: true,
            items: true,
            requiresOwnerApproval: true,
            ownerApprovedAt: true,
            ownerDeclinedAt: true,
            requiresNoPoConfirmation: true,
            noPoConfirmedAt: true,
            po: {
              select: {
                status: true,
                docNumber: true,
                paymentTermsDays: true,
                ppnRatePercent: true,
                items: { select: { id: true, itemId: true, variantSku: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
              },
            },
          },
        });
        for (const poId of [...new Set(grns.flatMap((g) => (g.poId ? [g.poId] : [])))].sort()) {
          await tx.$queryRaw`SELECT \`id\` FROM \`PurchaseOrder\` WHERE \`id\` = ${poId} FOR UPDATE`;
        }
        const byId = new Map(grns.map((g) => [g.id, g]));
        const [billed, returned] = await Promise.all([billedQtyByGrnLine(tx, grnIds), returnedQtyByGrnLine(tx, grnIds)]);
        const itemTypes = new Map(
          (await tx.item.findMany({ where: { id: { in: [...new Set(grnLines.map((l) => l.itemId))] } }, select: { id: true, type: true, nameId: true } })).map((i) => [
            i.id,
            i,
          ]),
        );
        for (const l of grnLines) {
          const g = byId.get(l.grnId);
          if (!g) throw new VendorBillError("Penerimaan barang tidak ditemukan, muat ulang halaman", "GRN_TIDAK_DITEMUKAN");
          if (g.supplierId !== data.supplierId) throw new VendorBillError(`${g.docNumber} bukan penerimaan dari supplier ini`, "BUKAN_PEMASOK_INI");
          if (g.po?.status === "CANCELLED") throw new VendorBillError(`${g.po.docNumber} sudah dibatalkan`, "PO_DIBATALKAN");
          if (g.ownerDeclinedAt != null) throw new VendorBillError(`${g.docNumber} ditolak pemilik; tidak bisa ditagih`, "GRN_DITOLAK_PEMILIK");
          if (g.requiresOwnerApproval && g.ownerApprovedAt == null) {
            throw new VendorBillError(`${g.docNumber}: penerimaan lebih menunggu keputusan pemilik; tagih setelah disetujui atau ditolak.`, "GRN_MENUNGGU_PEMILIK");
          }
          if (grnBelumDiproses(g)) {
            throw new VendorBillError(`${g.docNumber}: penerimaan tanpa PO menunggu konfirmasi admin; tagih setelah dikonfirmasi.`, "GRN_MENUNGGU_KONFIRMASI");
          }
          const variantSku = l.variantSku?.trim() || null;
          const key = grnLineKey(l.itemId, variantSku);
          const detail = readGrnLinesDetail(g.items).filter((d) => d.key === key);
          const it = itemTypes.get(l.itemId);
          if (detail.length === 0) throw new VendorBillError(`${g.docNumber} tidak menerima ${it?.nameId ?? l.itemId}`, "GRN_TANPA_BARANG_INI");
          const receivedQty = detail.reduce((s, d) => s + d.qty, 0);
          const src = grnLineSource(g.id, key);
          const remaining = round2(receivedQty - (returned.get(src) ?? 0) - (billed.get(src) ?? 0));
          if (l.qty > remaining + EPS) {
            throw new VendorBillError(
              `Qty tagihan ${it?.nameId ?? l.itemId} (${g.docNumber}) melebihi sisa yang diterima dan belum ditagih (${remaining})`,
              "MELEBIHI_SISA_PENERIMAAN",
            );
          }
          if (g.po?.paymentTermsDays != null) poTerms.push(g.po.paymentTermsDays);
          const recordedPrice = round2(detail.reduce((s, d) => s + d.qty * d.hargaDasar, 0) / receivedQty);
          const mode: ModePpnGrn = detail.some((d) => d.ppnMasukan) ? "PPN_MASUKAN" : detail.some((d) => d.ppnModal) ? "PPN_MODAL" : "TANPA";
          const poItem = g.po?.items.find((p) => grnLineKey(p.itemId, p.variantSku) === key) ?? null;
          const selisih = selisihUtangBarisGrn({
            qty: l.qty,
            hargaInvoice: l.price,
            hargaTercatat: recordedPrice,
            itemId: l.itemId,
            variantSku,
            tipeBarang: it?.type ?? detail[0].itemType,
            mode,
            tarifPo: g.po?.ppnRatePercent == null ? null : Number(g.po.ppnRatePercent),
            pengaturan,
            tanggalGrn: g.grnDate,
            grnId: g.id,
            nomorGrn: g.docNumber,
          });
          baru.push({
            type: "GRN_ITEM",
            grnId: g.id,
            itemId: l.itemId,
            variantSku,
            poItemId: poItem?.id ?? null,
            qty: l.qty,
            price: l.price,
            amount: round2(l.qty * l.price),
            refPrice: recordedPrice,
            koreksi:
              selisih.jumlah !== 0
                ? { jenis: "GRN", sumberId: g.id, itemId: l.itemId, variantSku, qty: l.qty, hargaTercatat: recordedPrice, hargaInvoice: l.price, selisih }
                : null,
          });
        }
      }

      if (stepLines.length > 0) {
        const steps = await tx.workOrderStep.findMany({
          where: { id: { in: stepLines.map((l) => l.sourceId) } },
          select: {
            id: true,
            supplierId: true,
            sequence: true,
            stepName: true,
            qty: true,
            servicePrice: true,
            servicePpnIncluded: true,
            supplier: { select: { isPkp: true } },
            wo: { select: { id: true, docNumber: true, status: true, finishedGoodId: true } },
          },
        });
        const byId = new Map(steps.map((s) => [s.id, s]));
        const billed = await billedQtyByWoStep(tx, steps.map((s) => s.id));
        const woIds = [...new Set(steps.map((s) => s.wo.id))];
        const unbooked = await unbookedReceiptQtyByWo(tx, woIds);
        // Receipts that booked CMT, oldest first: the booked pieces a correction is attributed to.
        const booked = await tx.fGReceipt.findMany({
          where: { woId: { in: woIds }, serviceCost: { not: null } },
          select: { id: true, woId: true, docNumber: true, receivedAt: true, qtyAccepted: true },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        });
        const varian = await varianPenerimaanFg(tx, booked.map((r) => r.id));
        for (const l of stepLines) {
          const st = byId.get(l.sourceId);
          if (!st) throw new VendorBillError("Step WO tidak ditemukan, muat ulang halaman");
          const where = `${st.wo.docNumber} step ${st.sequence}${st.stepName ? ` ${st.stepName}` : ""}`;
          if (st.supplierId !== data.supplierId) throw new VendorBillError(`${where} bukan milik supplier ini`, "BUKAN_PEMASOK_INI");
          if (st.wo.status === "CANCELLED") throw new VendorBillError(`${st.wo.docNumber} sudah dibatalkan`);
          const billedBefore = billed.get(st.id) ?? 0;
          const remaining = round2(Number(st.qty ?? 0) - billedBefore);
          if (l.qty > remaining + EPS) {
            throw new VendorBillError(`Qty tagihan ${where} melebihi sisa yang belum ditagih (${remaining})`);
          }
          // Pieces no finished-goods receipt booked; the step's earlier live bills hold them first.
          const unbookedAll = unbooked.get(st.wo.id) ?? 0;
          const unbookedLeft = Math.max(0, round2(unbookedAll - billedBefore));
          const share = Math.min(l.qty, unbookedLeft);
          if (share > 0) unbookedAmount = round2(unbookedAmount + round2(share * l.price));
          // The booked pieces of this line, after those the step's earlier live lines already hold.
          const q = round2(l.qty - share);
          let koreksi: BarisBaru["koreksi"] = null;
          if (q > EPS) {
            let lewati = Math.max(0, round2(billedBefore - Math.min(billedBefore, unbookedAll)));
            let sisa = q;
            const bagian: BagianPenerimaanJasa[] = [];
            for (const r of booked.filter((x) => x.woId === st.wo.id)) {
              if (sisa <= EPS) break;
              let qtyR = Number(r.qtyAccepted);
              const lompat = Math.min(lewati, qtyR);
              lewati = round2(lewati - lompat);
              qtyR = round2(qtyR - lompat);
              if (qtyR <= EPS) continue;
              const ambil = Math.min(sisa, qtyR);
              sisa = round2(sisa - ambil);
              const v = (varian.get(r.id) ?? []).filter((x) => x.variantSku !== "");
              bagian.push({ fgReceiptId: r.id, nomor: r.docNumber, tanggal: r.receivedAt, qty: ambil, varian: v });
            }
            const selisih = selisihUtangLangkah({
              langkah: {
                id: st.id,
                supplierId: st.supplierId,
                servicePrice: Number(st.servicePrice),
                servicePpnIncluded: st.servicePpnIncluded,
                pemasokPkp: st.supplier.isPkp,
              },
              hargaInvoice: l.price,
              bagian,
              itemId: st.wo.finishedGoodId,
              tipeBarang: "FINISHED_GOOD",
              pengaturan,
            });
            if (selisih.jumlah !== 0) {
              koreksi = {
                jenis: "WO_STEP",
                sumberId: st.id,
                itemId: st.wo.finishedGoodId,
                variantSku: null,
                qty: q,
                hargaTercatat: Number(st.servicePrice),
                hargaInvoice: l.price,
                selisih,
              };
            }
          }
          baru.push({
            type: "WO_STEP",
            woStepId: st.id,
            qty: l.qty,
            price: l.price,
            amount: round2(l.qty * l.price),
            refPrice: Number(st.servicePrice),
            koreksi,
          });
        }
      }

      const terms = poTerms.length > 0 ? Math.max(...poTerms) : supplier.paymentTermsDays ?? 0;
      const total = round2(baru.reduce((s, l) => s + Number(l.amount), 0));
      const docNumber = await generateDocNumber("VENDOR_BILL", tx);
      const bill = await tx.vendorBill.create({
        data: {
          docNumber,
          supplierId: data.supplierId,
          vendorInvoiceNo: data.vendorInvoiceNo,
          billDate: data.billDate,
          dueDate: data.dueDate ?? addDays(data.billDate, terms),
          total,
          status: total < EPS ? "PAID" : "UNPAID",
          notes: data.notes || null,
          createdById: userId,
        },
        select: { id: true, docNumber: true },
      });
      const koreksiBaru: BarisKoreksiBaru[] = [];
      for (const b of baru) {
        const { koreksi, ...isi } = b;
        const line = await tx.vendorBillLine.create({ data: { ...isi, billId: bill.id }, select: { id: true } });
        if (koreksi) koreksiBaru.push({ ...koreksi, billLineId: line.id });
      }

      if (unbookedAmount >= 0.01) {
        const res = await postVendorBillJournal(bill.id, unbookedAmount, userId, tx);
        if (!res.ok && res.code !== "NOTHING_TO_POST") throw journalRefusal(res);
      }
      // The captured notification is created here, inside this attempt, so a retried attempt never
      // carries an earlier attempt's row out to the fan-out.
      const k = await buatKoreksiUtang(tx, {
        bill: { id: bill.id, docNumber: bill.docNumber, vendorInvoiceNo: data.vendorInvoiceNo, billDate: data.billDate, supplierId: data.supplierId, namaPemasok: supplier.name },
        baris: koreksiBaru,
        olehUserId: userId,
      });
      return { id: bill.id, docNumber: bill.docNumber, koreksi: k.jumlah, notifikasi: k.notifikasi };
    },
    { timeout: 30_000 }
  );
}

/** Refusal code: voiding would leave a receipt paid above its payable (`penerimaanLebihBayarJikaDibatalkan`). */
export const VOID_WOULD_OVERPAY = "VOID_WOULD_OVERPAY";

/**
 * Voids a bill. Refused while an old vendor payment is live on it (that payment is allocated to this
 * bill), and when reversing what the bill booked — its old-CMT `VENDOR_BILL` journal and its ACCEPTED
 * price-difference corrections — would leave a receipt paid above its payable
 * (`penerimaanLebihBayarJikaDibatalkan`, read in this transaction). Otherwise it voids even when
 * Supplier payments paid its receipts — the payment then reads against the receipt's other bills — so
 * a wrongly entered invoice can be voided and entered again (Q17).
 *
 * In the same transaction: the bill journal is mirrored, its corrections are cancelled (waiting or
 * invoice-corrected) or reversed (accepted: reversal journal + the revaluation still in stock), and the
 * invoice requests on its receipts that it had closed are reopened.
 */
export async function voidVendorBill(billId: string, reason: string, userId: string) {
  const why = z.string().trim().min(1).max(500).parse(reason);
  return runSerializable(
    async (tx) => {
      const bill = await tx.vendorBill.findUnique({
        where: { id: billId },
        select: { status: true, docNumber: true, allocations: { where: { payment: { voidedAt: null } }, select: { id: true } } },
      });
      if (!bill) throw new VendorBillError("Tagihan tidak ditemukan");
      if (bill.status === "VOID") throw new VendorBillError(`${bill.docNumber} sudah dibatalkan`);
      if (bill.allocations.length > 0) {
        throw new VendorBillError(`${bill.docNumber} masih punya pembayaran Vendor Billing yang berlaku; batalkan pembayarannya dulu`);
      }
      const overpaid = await penerimaanLebihBayarJikaDibatalkan(tx, billId);
      if (overpaid.length > 0) {
        throw new VendorBillError(
          `${bill.docNumber} belum bisa dibatalkan: membatalkannya menurunkan utang ${overpaid.map((s) => s.label).join(", ")}, ` +
            "dan pembayaran pemasok atas penerimaan itu sudah melebihi utang yang tersisa tanpa tagihan ini. Batalkan pembayaran pemasoknya dulu.",
          VOID_WOULD_OVERPAY
        );
      }
      const waktu = new Date();
      const flipped = await tx.vendorBill.updateMany({
        where: { id: billId, status: { not: "VOID" } },
        data: { status: "VOID", voidedAt: waktu, voidReason: why },
      });
      if (flipped.count !== 1) throw new VendorBillError(`${bill.docNumber} sudah dibatalkan`);
      const res = await postVendorBillReversalJournal(billId, userId, tx);
      if (!res.ok && res.code !== "NOTHING_TO_POST") throw journalRefusal(res);
      try {
        await batalkanKoreksiTagihan(tx, { billId, alasan: why, olehUserId: userId, waktu });
      } catch (e) {
        const k = kodeTolakKoreksi(e);
        if (!k) throw e;
        if (k.kode === "UNMAPPED_ROLE") throw new VendorBillError(`Petakan akun untuk ${k.peran ?? "-"} di Pemetaan Akun dulu`, k.kode);
        throw new VendorBillError(`Koreksi utang tagihan ini gagal dibalik (${k.kode})`, k.kode);
      }
      await bukaLagiPermintaanTerdampak(tx, { billId });
      return { id: billId, docNumber: bill.docNumber };
    },
    { timeout: 30_000 }
  );
}

'use server';

import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@elorae/db';
import type { StockLedgerRefType } from '@elorae/db';
import { cariTeks } from "@/lib/db/cari-teks";
import { calculateMovingAverage, reverseMovingAverage, findExistingInventoryValueRow } from '@/lib/inventory/costing';
import { revalidatePath } from 'next/cache';
import { notifyGRNCreated, notifyMaterialArrivedForPo } from '@/lib/notifications/events';
import { getActorName } from "@/lib/notifications/actor-name";
import { logAudit } from '@/lib/audit';
import { assertLinesVariantSkusMatchItemDefinitions } from '@/lib/items/validate-variant-lines';
import { auth } from '@/lib/auth';
import { assertActor } from "@/lib/auth/assert-actor";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS } from '@/lib/rbac';
import { postGrnJournal, postGrnReversalJournal } from "@/lib/inventory/grn-journal";
import { hitungPpnMasukanGrn, kunciBarisPpn } from "@/lib/finance/pajak/grn-ppn";
import { hitungPpnKapitalisasiGrn } from "@/lib/finance/operasional/grn-kapitalisasi-queries";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { computeActualLeadDays } from '@/lib/leadtime/calculations';
import { fanOutAdminNotification } from '@/lib/notifications/admin-fanout';
import { docNumberPeriod } from "@/lib/doc-numbers/period";
import { recomputePaymentDueDate } from "@/lib/purchase-orders/payment-due";
import { toReceiptRefusal, type ReceiptRefusal, type ReceiptRefusalCode } from "@/lib/inventory/receipt-refusal";
import { ReceiptLineError } from "@/lib/inventory/receipt-errors";
import { grnSchema as baseGrnSchema } from "@/lib/grn/schema";
import { fabricRollCode } from "@/lib/grn/roll-code";
import { overReceiveBy, sumRollLengths } from "@/lib/grn/over-receive";
import { billedQtyByPoItem } from "@/lib/vendor-billing/billable";
import { runSerializable } from "@/lib/db/tx-retry";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { alasanTolakPenerimaanPo } from "@/lib/purchase-orders/penerimaan";
import { syaratCariGrn } from "@/lib/inventory/cari-grn";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import {
  PESAN_PEMILIK_GRN,
  kodeTolakPemilikGrn,
  type KodeTolakPemilikGrn,
} from "@/app/backoffice/inventory/grn/kode-pemilik";
import {
  fotoGrn,
  keadaanPemilikGrn,
  susunBarisGrn,
  type BarangGrn,
  type BarisRincianGrn,
} from "@/app/backoffice/inventory/grn/[id]/rincian-grn";

const grnSchema = baseGrnSchema.extend({
  /** Kunci kiriman: dibuat formulir SEKALI per isian (disimpan bersama draf GRN). */
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export type GRNFormData = z.infer<typeof grnSchema>;

/** Hasil `createGRN`. `ulang` = kiriman ulang berkunci sama; GRN yang sudah ada dikembalikan. */
export type HasilCreateGRN = {
  id: string;
  docNumber: string;
  poId: string | null;
  supplierId: string;
  receivedBy: string;
  totalAmount: number;
  photoUrls: string | null;
  items: unknown;
  notes: string | null;
  grnDate: Date;
  createdAt: Date;
  ulang: boolean;
};

const KOLOM_HASIL_GRN = {
  id: true,
  docNumber: true,
  poId: true,
  supplierId: true,
  receivedBy: true,
  totalAmount: true,
  photoUrls: true,
  items: true,
  notes: true,
  grnDate: true,
  createdAt: true,
} as const;

type BarisHasilGrn = {
  id: string;
  docNumber: string;
  poId: string | null;
  supplierId: string;
  receivedBy: string;
  totalAmount: { toString(): string } | number;
  photoUrls: string | null;
  items: unknown;
  notes: string | null;
  grnDate: Date;
  createdAt: Date;
};

function hasilGrn(grn: BarisHasilGrn, ulang: boolean): HasilCreateGRN {
  return { ...grn, totalAmount: Number(grn.totalAmount), ulang };
}

/** GRN yang sudah tercatat dengan kunci kiriman ini (di luar atau di dalam transaksi). */
async function grnDenganKunci(
  db: Pick<typeof prisma, 'gRN'>,
  kunci: string,
): Promise<HasilCreateGRN | null> {
  const lama = await db.gRN.findUnique({ where: { idempotencyKey: kunci }, select: KOLOM_HASIL_GRN });
  return lama ? hasilGrn(lama, true) : null;
}

function grnPoLineKey(itemId: string, variantSku?: string | null) {
  const v = variantSku?.trim() ?? '';
  return `${itemId}\t${v}`;
}

type StoredGrnLine = {
  itemId?: string;
  variantSku?: string | null;
  qty?: unknown;
  unitCost?: unknown;
};

function parseGrnStoredLines(raw: unknown): StoredGrnLine[] {
  if (raw == null) return [];
  let arr: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      arr = Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }
  return arr as StoredGrnLine[];
}

/**
 * Penolakan GRN berkode. `createGRN` melemparnya (pemanggil lama + tes);
 * formulir GRN memakai `simpanGRN`, yang mengembalikannya sebagai `{ ok:false, code }`.
 */
const PESAN_TOLAK_GRN = {
  PO_TIDAK_DITEMUKAN: "PO tidak ditemukan.",
  PO_DIBATALKAN: "PO ini sudah dibatalkan, jadi barang tidak bisa diterima ke PO ini.",
  PO_BELUM_DISETUJUI: "PO ini masih draf dan belum disetujui. Setujui dan kirim PO dulu sebelum menerima barang.",
  PO_DITUTUP: "PO ini sudah ditutup, jadi barang tidak bisa diterima ke PO ini lagi.",
} as const;

class GrnDitolakError extends Error {
  readonly code: keyof typeof PESAN_TOLAK_GRN;

  constructor(code: keyof typeof PESAN_TOLAK_GRN) {
    super(PESAN_TOLAK_GRN[code]);
    this.name = "GrnDitolakError";
    this.code = code;
  }
}

export type CreateGRNResult =
  | { success: true; grn: HasilCreateGRN }
  | ReceiptRefusal;

export async function createGRN(data: z.infer<typeof grnSchema>, userId?: string): Promise<CreateGRNResult> {
  try {
    return { success: true, grn: await createGRNInner(data, userId) };
  } catch (error) {
    const refusal = toReceiptRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

/**
 * Penerima GRN selalu pengguna sesi; `claimedUserId`, kalau dikirim, harus sama
 * dengannya (`assertActor`).
 *
 * Status PO dibaca DI DALAM transaksi serializable sebelum stok disentuh, dan
 * baris PO selalu ditulis transaksi ini: pembatalan atau "Tutup PO" yang commit
 * di tengah GRN membuat GRN konflik, diulang, lalu ditolak (`PO_DIBATALKAN` /
 * `PO_DITUTUP`).
 *
 * CLOSED punya dua arti: lengkap lewat GRN (`closedAt` kosong, semua baris
 * diterima penuh) atau ditutup sebelum lengkap — lewat "Tutup PO" (`closedAt`
 * terisi) atau jalur tutup lama yang belum menulis `closedAt` (barang kurang).
 * Hanya yang lengkap boleh menerima terima-lebih yang sah (lewat ambang /
 * persetujuan pemilik), sama seperti PO berstatus OVER; sisanya `PO_DITUTUP`.
 *
 * `idempotencyKey` (dibuat formulir SEKALI per isian) diperiksa PALING DULU —
 * sebelum penjaga status PO, karena GRN pertama bisa sudah menutup PO-nya — lalu
 * sekali lagi DI DALAM transaksi: kiriman ulang sesudah jawaban hilang, klik
 * ganda, atau percobaan ulang `runSerializable` sesudah balapan mendapat GRN
 * yang sama (`ulang: true`) tanpa menyentuh stok, harga rata-rata, status PO,
 * maupun jurnal hutang lagi.
 */
async function createGRNInner(data: z.infer<typeof grnSchema>, claimedUserId?: string): Promise<HasilCreateGRN> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.INVENTORY_MANAGE);
  if (claimedUserId !== undefined) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  const validated = grnSchema.parse(data);
  const kunci = validated.idempotencyKey ?? null;
  if (kunci) {
    const lama = await grnDenganKunci(prisma, kunci);
    if (lama) return lama;
  }
  await assertLinesVariantSkusMatchItemDefinitions(prisma.item, validated.items);

  const terima = () => runSerializable(async (tx): Promise<HasilCreateGRN> => {
    // Lagi, di dalam transaksi: percobaan ulang sesudah konflik melihat GRN pemenangnya.
    if (kunci) {
      const lama = await grnDenganKunci(tx, kunci);
      if (lama) return lama;
    }

    if (validated.poId) {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: validated.poId },
        select: { status: true, closedAt: true, items: { select: { qty: true, receivedQty: true } } },
      });
      if (!po) throw new GrnDitolakError("PO_TIDAK_DITEMUKAN");
      const tolak = alasanTolakPenerimaanPo(po.status);
      // CLOSED tanpa `closedAt` DAN semua baris diterima penuh = lengkap lewat GRN:
      // terima-lebih tetap boleh. CLOSED tanpa `closedAt` yang barangnya kurang =
      // ditutup lewat jalur lama (sebelum `closedAt` ada) → tetap ditolak.
      const lengkapNormal =
        tolak === "PO_DITUTUP" &&
        po.closedAt == null &&
        po.items.every((l) => new Decimal(l.receivedQty.toString()).gte(l.qty.toString()));
      if (tolak && !lengkapNormal) throw new GrnDitolakError(tolak);
      // Tulis baris PO sekarang juga (terima-lebih bisa melewatkan pembaruan status):
      // perubahan PO oleh transaksi lain sesudah pembacaan di atas jadi konflik serialisasi.
      await tx.purchaseOrder.update({ where: { id: validated.poId }, data: { updatedAt: new Date() } });
    }

    const now = new Date();
    const { year, month } = docNumberPeriod(now);
    const prefix = `GRN/${year}/${String(month).padStart(2, "0")}/`;
    const existing = await tx.gRN.findMany({
      where: { docNumber: { startsWith: prefix } },
      select: { docNumber: true },
      orderBy: { docNumber: 'desc' },
      take: 1,
    });
    const nextNum = existing.length
      ? (parseInt(existing[0].docNumber.slice(prefix.length), 10) || 0) + 1
      : 1;
    const docNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

    let totalAmount = new Decimal(0);

    // PPN pembelian saat Elorae BUKAN PKP (baris PO "Exclude PPN"): bagian dari harga
    // perolehan — masuk nilai kartu stok dan hutang bruto (`lib/finance/operasional/grn-kapitalisasi.ts`).
    // Dihitung SEBELUM stok bergerak, dari qty yang sama dengan baris stoknya.
    const tipeBarangAwal = new Map(
      (
        await tx.item.findMany({ where: { id: { in: [...new Set(validated.items.map((i) => i.itemId))] } }, select: { id: true, type: true } })
      ).map((i) => [i.id, i.type as string]),
    );
    const qtyBarisAwal = validated.items.map((item) => {
      const rolls = item.rolls ?? [];
      return tipeBarangAwal.get(item.itemId) === 'FABRIC' && rolls.length > 0 ? sumRollLengths(rolls.map((roll) => roll.length)) : item.qty;
    });
    const ppnModal = await hitungPpnKapitalisasiGrn(tx, {
      poId: validated.poId ?? null,
      baris: validated.items.map((item, i) => ({
        itemId: item.itemId,
        variantSku: item.variantSku?.trim() || null,
        nilai: new Decimal(qtyBarisAwal[i]).mul(item.unitCost).toNumber(),
      })),
      tanggal: now,
    });

    // Pass 1: resolve item metadata and derive quantities/costs without touching InventoryValue.
    // calculateMovingAverage needs the GRN's own id as the ledger ref, so it can only run once
    // the GRN row exists — see the cost pass below, after tx.gRN.create.
    // Unit cost per line as an exact Decimal (PO price + capitalised PPN share), for the cost pass.
    const unitCostPerLine: Decimal[] = [];
    const baseItems = await Promise.all(
      validated.items.map(async (item, idxBaris) => {
        const itemRow = await tx.item.findUnique({
          where: { id: item.itemId },
          select: { type: true, uomId: true, overReceiveThreshold: true },
        });
        if (!itemRow) {
          throw new ReceiptLineError("ITEM_NOT_FOUND", item.itemId, `Item not found: ${item.itemId}`);
        }
        const isFabric = itemRow.type === 'FABRIC';
        const rolls = item.rolls ?? [];
        const derivedQty = isFabric && rolls.length > 0
          ? sumRollLengths(rolls.map((roll) => roll.length))
          : item.qty;
        const qty = new Decimal(derivedQty);
        const ppnBaris = new Decimal(ppnModal[idxBaris] ?? 0);
        const lineTotal = qty.mul(item.unitCost).plus(ppnBaris);
        // Harga per unit di kartu stok = harga PO + bagian PPN yang dikapitalisasi.
        const unitCost = ppnBaris.gt(0) && qty.gt(0) ? lineTotal.div(qty) : new Decimal(item.unitCost);
        totalAmount = totalAmount.plus(lineTotal);

        unitCostPerLine[idxBaris] = unitCost;
        return {
          itemId: item.itemId,
          // Raw (untrimmed) key used for the cost calc / stock movement; kept separate from the
          // trimmed `variantSku` snapshot field below, matching the original behavior.
          variantKey: item.variantSku ?? null,
          variantSku: item.variantSku?.trim() || null,
          qty: derivedQty,
          unitCost: unitCost.toNumber(),
          // Harga PO dan PPN yang ikut dikapitalisasi (bukan PKP) — supaya harga per unit di atas terjelaskan.
          hargaPo: ppnBaris.gt(0) ? item.unitCost : undefined,
          ppnDikapitalisasi: ppnBaris.gt(0) ? ppnBaris.toNumber() : undefined,
          itemType: itemRow.type,
          uomId: item.uomId || itemRow.uomId,
          overReceiveThreshold: itemRow.overReceiveThreshold != null ? Number(itemRow.overReceiveThreshold) : null,
          rolls,
          totalCost: lineTotal.toNumber(),
        };
      })
    );

    let requiresOwnerApproval = false;
    if (validated.poId) {
      const poItems = await tx.pOItem.findMany({
        where: { poId: validated.poId },
        select: { itemId: true, variantSku: true, qty: true, receivedQty: true },
      });
      const poMap = new Map(
        poItems.map((poItem) => [
          grnPoLineKey(poItem.itemId, poItem.variantSku),
          poItem,
        ])
      );
      for (const item of baseItems) {
        const poItem = poMap.get(grnPoLineKey(item.itemId, item.variantSku));
        if (!poItem) continue;
        const overBy = overReceiveBy(
          poItem.receivedQty.toString(),
          item.qty,
          poItem.qty.toString()
        );
        const threshold = Number(item.overReceiveThreshold ?? 0);
        if (overBy.gt(threshold)) {
          requiresOwnerApproval = true;
          break;
        }
      }
    }

    // PPN masukan (hanya PKP, baris PO "Exclude PPN") dihitung SEKALI di sini dan
    // disimpan; jurnal penerimaan membaca angka tersimpan ini, bukan pengaturan
    // hari ini (`lib/finance/pajak/grn-ppn.ts`). Nilai stok tidak berubah.
    const ppnMasukan = await hitungPpnMasukanGrn(tx, {
      poId: validated.poId ?? null,
      baris: baseItems.map((p) => ({ itemId: p.itemId, variantSku: p.variantSku, nilai: p.totalCost })),
      tanggal: now,
    });

    const grn = await tx.gRN.create({
      data: {
        docNumber,
        poId: validated.poId ?? null,
        supplierId: validated.supplierId,
        receivedBy: userId,
        totalAmount: totalAmount.toNumber(),
        ppnAmount: ppnMasukan.ppn,
        requiresOwnerApproval,
        photoUrls: validated.photoUrls ? JSON.stringify(validated.photoUrls) : null,
        // Placeholder — patched below with the cost-calc results once grn.id exists to ref.
        items: JSON.stringify(baseItems),
        notes: validated.notes ?? null,
        idempotencyKey: kunci,
      },
    });

    // Pass 2: run the moving-average cost calc now that grn.id is a real ledger ref. Sequential
    // (not Promise.all) — the schema doesn't forbid the same itemId twice in one payload, and
    // interleaved awaits on a never-before-stocked item could otherwise fork a duplicate
    // InventoryValue row (MySQL treats variantSku null as distinct in the unique index, so the
    // @@unique([itemId, variantSku]) constraint doesn't catch it).
    const processedItems: Array<{
      itemId: string;
      variantSku: string | null;
      qty: number;
      unitCost: number;
      itemType: string;
      uomId: string;
      overReceiveThreshold: number | null;
      rolls: (typeof baseItems)[number]["rolls"];
      totalCost: number;
      hargaPo?: number;
      ppnDikapitalisasi?: number;
      prevAvgCost: number;
      newAvgCost: number;
      prevQty: number;
      newQty: number;
    }> = [];
    for (const [idxBaris, item] of baseItems.entries()) {
      const qty = new Decimal(item.qty);
      const unitCost = unitCostPerLine[idxBaris] ?? new Decimal(item.unitCost);
      const costCalc = await calculateMovingAverage(
        item.itemId,
        qty,
        unitCost,
        tx,
        item.variantKey,
        { refType: 'GRN' satisfies StockLedgerRefType, refId: grn.id, refDocNumber: docNumber, createdById: userId }
      );

      processedItems.push({
        itemId: item.itemId,
        variantSku: item.variantSku,
        qty: item.qty,
        unitCost: item.unitCost,
        itemType: item.itemType,
        uomId: item.uomId,
        overReceiveThreshold: item.overReceiveThreshold,
        rolls: item.rolls,
        totalCost: item.totalCost,
        ...(item.ppnDikapitalisasi !== undefined
          ? { hargaPo: item.hargaPo, ppnDikapitalisasi: item.ppnDikapitalisasi }
          : {}),
        prevAvgCost: costCalc.previousAvgCost.toNumber(),
        newAvgCost: costCalc.newAvgCost.toNumber(),
        prevQty: costCalc.previousQty.toNumber(),
        newQty: costCalc.newQty.toNumber(),
      });
    }

    const itemsTersimpan = processedItems.map((p) =>
      ppnMasukan.kenaPpn.has(kunciBarisPpn(p.itemId, p.variantSku)) ? { ...p, ppnIncluded: false } : p,
    );
    const itemsJson = JSON.stringify(itemsTersimpan);
    await tx.gRN.update({
      where: { id: grn.id },
      data: { items: itemsJson },
    });

    const totalRolls = processedItems.reduce(
      (sum, item) =>
        item.itemType === "FABRIC" && Array.isArray(item.rolls) ? sum + item.rolls.length : sum,
      0
    );
    let rollSeq = 0;
    const rollCreates: Array<{
      grnId: string;
      itemId: string;
      rollCode: string;
      rollRef: string;
      initialLength: number;
      remainingLength: number;
      uomId: string;
      notes: string | null;
    }> = [];
    for (const item of processedItems) {
      if (item.itemType !== 'FABRIC' || !Array.isArray(item.rolls) || item.rolls.length === 0) continue;
      for (let index = 0; index < item.rolls.length; index++) {
        rollSeq += 1;
        const roll = item.rolls[index];
        rollCreates.push({
          grnId: grn.id,
          itemId: item.itemId,
          rollCode: fabricRollCode(docNumber, rollSeq, totalRolls),
          rollRef: roll.rollRef || `ROLL-${index + 1}`,
          initialLength: roll.length,
          remainingLength: roll.length,
          uomId: item.uomId,
          notes: roll.notes ?? null,
        });
      }
    }
    if (rollCreates.length > 0) {
      await tx.fabricRoll.createMany({ data: rollCreates });
    }

    if (validated.poId) {
      for (let i = 0; i < validated.items.length; i++) {
        const item = validated.items[i];
        const proc = processedItems[i];
        const incQty = proc ? Number(proc.qty) : Number(item.qty);
        const variantSku = item.variantSku?.trim() || null;
        await tx.pOItem.updateMany({
          where: {
            poId: validated.poId!,
            itemId: item.itemId,
            variantSku,
          },
          data: {
            receivedQty: { increment: incQty },
          },
        });
      }

      const poItems = await tx.pOItem.findMany({
        where: { poId: validated.poId },
      });

      const allFullyReceived = poItems.every((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gte(poItem.qty.toString())
      );
      const anyOverReceived = poItems.some((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gt(poItem.qty.toString())
      );
      const anyReceived = poItems.some((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gt(0)
      );

      let newStatus: 'SUBMITTED' | 'PARTIAL' | 'CLOSED' | 'OVER' = 'SUBMITTED';
      if (allFullyReceived) newStatus = anyOverReceived ? 'OVER' : 'CLOSED';
      else if (anyReceived) newStatus = 'PARTIAL';

      // Defer PO status transition to CLOSED/OVER until GRN is owner-approved when over-receive
      const shouldUpdatePOStatus = !requiresOwnerApproval;
      if (shouldUpdatePOStatus) {
        await tx.purchaseOrder.update({
          where: { id: validated.poId },
          data: { status: newStatus },
        });

        await tx.pOStatusHistory.create({
          data: {
            poId: validated.poId,
            status: newStatus,
            changedById: userId,
            notes: `GRN issued: ${grn.docNumber}`,
          },
        });
      }

      // Lead time actual capture — first GRN only
      if (validated.poId) {
        const poForLead = await tx.purchaseOrder.findUnique({
          where: { id: validated.poId },
          select: { id: true, createdAt: true, actualLeadDays: true },
        });
        if (poForLead && poForLead.actualLeadDays == null) {
          await tx.purchaseOrder.update({
            where: { id: validated.poId },
            data: {
              actualLeadDays: computeActualLeadDays(
                poForLead.createdAt,
                grn.grnDate
              ),
            },
          });
        }
      }

      await recomputePaymentDueDate(tx, validated.poId);
    }

    revalidatePath('/backoffice/inventory');
    return hasilGrn({ ...grn, items: itemsJson }, false);
  });

  let result: HasilCreateGRN;
  try {
    result = await terima();
  } catch (err) {
    // Kiriman kembarnya commit lebih dulu dan bentrok di kolom kunci (tidak
    // diulang runSerializable): percobaan ini membaca kunci yang kini tercatat.
    if (!kunci || !bentrokKunciKiriman(err)) throw err;
    result = await terima();
  }
  // Ulangan: barang tidak masuk lagi — notifikasi, push stok, dan jurnal tidak dikirim lagi.
  if (result.ulang) return result;

  getActorName(userId)
    .then((triggeredByName) => notifyGRNCreated(result.id, result.docNumber, triggeredByName))
    .catch(() => {});

  if (result.poId) {
    void notifyMaterialArrivedForPo(result.poId, result.docNumber).catch((err) => {
      console.warn('[leadtime] MATERIAL_ARRIVED notify failed', err);
    });
  }

  logAudit({
    userId,
    action: 'CREATE',
    entityType: 'GRN',
    entityId: result.id,
    changes: { after: { docNumber: result.docNumber } },
  }).catch(() => {});

  // Sesudah commit: kirim stok baru ke Jubelio (best-effort, tidak pernah melempar).
  await antrekanPushStok(
    validated.items.map((i) => i.itemId),
    { sumber: 'GRN', ref: result.docNumber, userId },
  );

  try {
    const jr = await postGrnJournal(result.id, userId);
    if (!jr.ok && jr.code !== "NOTHING_TO_POST") {
      const receiptJournalPendingNotification = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "GRN journal not posted",
          message: `GRN journal could not be posted (${jr.code}${jr.role ? `: ${jr.role}` : ""}). Map the account, then post from the GRN row.`,
          metadata: { grnId: result.id, kind: "receipt", reason: jr.code, role: jr.role ?? null },
        },
      });
      void fanOutAdminNotification(receiptJournalPendingNotification);
    }
  } catch (e) {
    try {
      const receiptJournalErrorNotification = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "GRN journal not posted",
          message: `GRN journal errored (${e instanceof Error ? e.message : "unknown"}). Map/verify the account, then post from the GRN row.`,
          metadata: { grnId: result.id, kind: "receipt", reason: "ERROR", role: null },
        },
      });
      void fanOutAdminNotification(receiptJournalErrorNotification);
    } catch {
      // best-effort: a notification failure must never fail the GRN
    }
  }

  return result;
}

/** Penjaga baca GRN: sesi (`Unauthorized`) + `inventory:view` atau salah satu izin `extra` (`Forbidden`). */
async function requireGrnRead(extra: string[] = []): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requireAnyPermission(session.user.permissions ?? [], [PERMISSIONS.INVENTORY_VIEW, ...extra]);
}

export type KodeTolakGrn = keyof typeof PESAN_TOLAK_GRN;

export type SimpanGRNResult =
  /** `ulang: true` hanya pada kiriman ulang berkunci sama (GRN yang sudah ada). */
  | { ok: true; id: string; docNumber: string; ulang?: true }
  | { ok: false; code: KodeTolakGrn | ReceiptRefusalCode; detail?: string };

/**
 * `createGRN` untuk formulir GRN: penolakan berkode DIKEMBALIKAN, bukan
 * dilempar — di build produksi Next menyamarkan pesan lemparan aksi server,
 * jadi layar hanya bisa menjelaskan "PO sudah dibatalkan" lewat kodenya.
 * Galat lain (izin, validasi) tetap dilempar seperti `createGRN`.
 */
export async function simpanGRN(data: GRNFormData): Promise<SimpanGRNResult> {
  try {
    const hasil = await createGRN(data);
    if (!hasil.success) return { ok: false, code: hasil.code, ...(hasil.detail ? { detail: hasil.detail } : {}) };
    const grn = hasil.grn;
    return { ok: true, id: grn.id, docNumber: grn.docNumber, ...(grn.ulang ? { ulang: true as const } : {}) };
  } catch (error) {
    if (error instanceof GrnDitolakError) return { ok: false, code: error.code };
    throw error;
  }
}

/** Kolom pemasok yang aman dikirim ke browser — tanpa `bankAccountEnc`. */
const PEMASOK_AMAN = {
  id: true,
  code: true,
  name: true,
  typeId: true,
  address: true,
  phone: true,
  email: true,
  isActive: true,
  status: true,
} as const;

/**
 * Daftar GRN: halaman inventori (`inventory:view`) dan formulir retur pemasok
 * (`vendor_returns:view`).
 */
export async function getGRNs(
  filters?: {
    supplierId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    poId?: string;
    search?: string;
    /** Kata kunci (nomor GRN, pemasok, nomor PO) — disaring di server, lihat `syaratCariGrn`. */
    cari?: string;
  },
  opts?: { page: number; pageSize: number }
) {
  await requireGrnRead([PERMISSIONS.VENDOR_RETURNS_VIEW]);
  const where: Record<string, unknown> = {};
  if (filters?.supplierId) where.supplierId = filters.supplierId;
  if (filters?.poId) where.poId = filters.poId;
  const cari = syaratCariGrn(filters?.cari);
  if (cari) where.AND = [cari];
  if (filters?.dateFrom || filters?.dateTo) {
    where.grnDate = {};
    if (filters.dateFrom) (where.grnDate as Record<string, Date>).gte = filters.dateFrom;
    if (filters.dateTo) (where.grnDate as Record<string, Date>).lte = filters.dateTo;
  }
  const search = filters?.search?.trim();
  if (search) {
    where.OR = [
      { docNumber: { contains: search } },
      { supplier: { name: { contains: search } } },
      { po: { docNumber: { contains: search } } },
    ];
  }

  const include = {
    supplier: { select: PEMASOK_AMAN },
    po: { select: { id: true, docNumber: true } },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.gRN.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { grnDate: 'desc' },
      }),
      prisma.gRN.count({ where }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      ppnAmount: r.ppnAmount == null ? null : Number(r.ppnAmount),
    }));
    return { items, totalCount };
  }

  const rows = await prisma.gRN.findMany({
    where,
    include,
    orderBy: { grnDate: 'desc' },
  });
  return rows.map((r) => ({
    ...r,
    totalAmount: Number(r.totalAmount),
    ppnAmount: r.ppnAmount == null ? null : Number(r.ppnAmount),
  }));
}

export async function getGRNById(id: string) {
  await requireGrnRead([PERMISSIONS.VENDOR_RETURNS_VIEW]);
  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: {
      supplier: { select: PEMASOK_AMAN },
      po: {
        include: { supplier: { select: PEMASOK_AMAN } },
      },
    },
  });
  if (!grn) return null;
  return {
    ...grn,
    totalAmount: Number(grn.totalAmount),
    ppnAmount: grn.ppnAmount == null ? null : Number(grn.ppnAmount),
  };
}

/** Fetch fabric rolls for a GRN (for collapsible row). Returns plain objects (no Decimal). */
export async function getRollsByGrnId(grnId: string) {
  await requireGrnRead();
  const rolls = await prisma.fabricRoll.findMany({
    where: { grnId },
    include: {
      item: { select: { sku: true, nameId: true } },
      uom: { select: { code: true } },
    },
    orderBy: { rollCode: 'asc' },
  });
  return rolls.map((r) => ({
    id: r.id,
    rollCode: r.rollCode,
    rollRef: r.rollRef,
    initialLength: Number(r.initialLength),
    remainingLength: Number(r.remainingLength),
    isClosed: r.isClosed,
    notes: r.notes,
    item: r.item,
    uom: r.uom,
  }));
}

/** Options for By Roll tab filters: GRNs and items that have at least one roll. */
export async function getFabricRollFilterOptions(): Promise<{
  grnOptions: Array<{ value: string; label: string }>;
  itemOptions: Array<{ value: string; label: string }>;
}> {
  await requireGrnRead();
  const [grnIdsRaw, itemIds] = await Promise.all([
    prisma.fabricRoll.findMany({ select: { grnId: true }, distinct: ['grnId'] }),
    prisma.fabricRoll.findMany({ select: { itemId: true }, distinct: ['itemId'] }),
  ]);
  const grnIds = grnIdsRaw.filter((r) => r.grnId != null) as { grnId: string }[];
  const [grns, items] = await Promise.all([
    grnIds.length ? prisma.gRN.findMany({ where: { id: { in: grnIds.map((r) => r.grnId) } }, select: { id: true, docNumber: true }, orderBy: { grnDate: 'desc' } }) : [],
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds.map((r) => r.itemId) } }, select: { id: true, sku: true, nameId: true }, orderBy: { sku: 'asc' } }) : [],
  ]);
  return {
    grnOptions: grns.map((g) => ({ value: g.id, label: g.docNumber })),
    itemOptions: items.map((i) => ({ value: i.id, label: `${i.sku} – ${i.nameId}` })),
  };
}

/** Fetch all fabric rolls (for By Roll tab). Returns plain objects (no Decimal). */
export async function getFabricRolls(opts?: {
  page: number;
  pageSize: number;
  grnId?: string;
  itemId?: string;
  search?: string;
}) {
  await requireGrnRead();
  const toNum = (v: unknown) => (v == null ? null : Number(v));
  const where: Record<string, unknown> = {};
  if (opts?.grnId) where.grnId = opts.grnId;
  if (opts?.itemId) where.itemId = opts.itemId;
  const search = opts?.search?.trim();
  if (search && search.length > 0) {
    where.OR = [
      { rollCode: cariTeks(search) },
      { rollRef: cariTeks(search) },
      { item: { sku: cariTeks(search) } },
      { item: { nameId: cariTeks(search) } },
      { grn: { docNumber: cariTeks(search) } },
    ];
  }

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.fabricRoll.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          item: { select: { sku: true, nameId: true } },
          uom: { select: { code: true } },
          grn: { select: { docNumber: true, grnDate: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.fabricRoll.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rollCode: r.rollCode,
        rollRef: r.rollRef,
        initialLength: toNum(r.initialLength),
        remainingLength: toNum(r.remainingLength),
        isClosed: r.isClosed,
        notes: r.notes,
        item: r.item,
        uom: r.uom,
        grn: r.grn,
      })),
      totalCount,
    };
  }
  const rows = await prisma.fabricRoll.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      item: { select: { sku: true, nameId: true } },
      uom: { select: { code: true } },
      grn: { select: { docNumber: true, grnDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    rollCode: r.rollCode,
    rollRef: r.rollRef,
    initialLength: toNum(r.initialLength),
    remainingLength: toNum(r.remainingLength),
    isClosed: r.isClosed,
    notes: r.notes,
    item: r.item,
    uom: r.uom,
    grn: r.grn,
  }));
}

/**
 * Pemilik = admin sistem: izin wildcard `*` yang diberikan `lib/auth.ts` untuk
 * `RoleDefinition.isSystem`. Tidak ada izin "pemilik" tersendiri, dan kolom lama
 * `User.role` tidak dipakai lagi. Pengguna SELALU dari sesi — dulu id yang
 * dikirim klien yang diperiksa, jadi siapa pun dengan `inventory:manage` cukup
 * mengirim id admin.
 */
async function wajibPemilik(tindakan: 'approve' | 'decline', claimedUserId?: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  const perms = session.user.permissions ?? [];
  requirePermission(perms, PERMISSIONS.INVENTORY_MANAGE);
  if (claimedUserId !== undefined) assertActor(session.user.id, claimedUserId);
  if (!perms.includes('*')) {
    throw new Error(`Only owner/admin can ${tindakan} over-receive GRN`);
  }
  return session.user.id;
}

type GrnPoStatus = 'SUBMITTED' | 'PARTIAL' | 'CLOSED' | 'OVER';

function statusPoDariBaris(poItems: Array<{ qty: unknown; receivedQty: unknown }>): GrnPoStatus {
  const allFullyReceived = poItems.every((poItem) =>
    new Decimal(String(poItem.receivedQty)).gte(String(poItem.qty))
  );
  const anyOverReceived = poItems.some((poItem) =>
    new Decimal(String(poItem.receivedQty)).gt(String(poItem.qty))
  );
  const anyReceived = poItems.some((poItem) => new Decimal(String(poItem.receivedQty)).gt(0));
  if (allFullyReceived) return anyOverReceived ? 'OVER' : 'CLOSED';
  if (anyReceived) return 'PARTIAL';
  return 'SUBMITTED';
}

/**
 * Pemilik menyetujui GRN terima-lebih. Pengguna dari sesi; `claimedUserId`, kalau dikirim, harus sama (lihat `wajibPemilik`).
 * Penjaga keadaan + pembaruan + status PO berjalan dalam satu transaksi
 * serializable: GRN yang sudah disetujui/ditolak tidak bisa disetujui lagi, dan
 * setuju-vs-tolak serentak hanya menghasilkan satu pemenang.
 */
export async function approveGRNByOwner(id: string, claimedUserId?: string) {
  const userId = await wajibPemilik('approve', claimedUserId);

  const grn = await runSerializable(async (tx) => {
    const cur = await tx.gRN.findUnique({ where: { id } });
    if (!cur) throw new Error(PESAN_PEMILIK_GRN.TIDAK_DITEMUKAN);
    if (cur.ownerDeclinedAt != null) throw new Error(PESAN_PEMILIK_GRN.SUDAH_DITOLAK);
    if (cur.ownerApprovedAt != null) throw new Error(PESAN_PEMILIK_GRN.SUDAH_DISETUJUI);
    if (!cur.requiresOwnerApproval) throw new Error(PESAN_PEMILIK_GRN.TIDAK_MENUNGGU);

    const updated = await tx.gRN.update({
      where: { id },
      data: {
        requiresOwnerApproval: false,
        ownerApprovedAt: new Date(),
        ownerApprovedById: userId,
      },
    });

    // Recompute PO status now that GRN is approved (deferred transition to CLOSED/OVER)
    if (updated.poId) {
      const poItems = await tx.pOItem.findMany({ where: { poId: updated.poId } });
      const newStatus = statusPoDariBaris(poItems);
      await tx.purchaseOrder.update({
        where: { id: updated.poId },
        data: { status: newStatus },
      });
      await tx.pOStatusHistory.create({
        data: {
          poId: updated.poId,
          status: newStatus,
          changedById: userId,
          notes: `GRN owner-approved: ${updated.docNumber}`,
        },
      });
    }
    return updated;
  });

  if (grn.poId) revalidatePath(`/backoffice/purchase-orders/${grn.poId}`);
  revalidatePath('/backoffice/inventory');
  return { ...grn, totalAmount: Number(grn.totalAmount), ppnAmount: grn.ppnAmount == null ? null : Number(grn.ppnAmount) };
}

/**
 * Owner declines an over-receive GRN: reverse inventory and PO received qty, remove fabric rolls, record decline.
 * Fails if fabric rolls from this GRN were partially consumed or on-hand qty is insufficient.
 */
export async function declineGRNByOwner(id: string, claimedUserId?: string) {
  const userId = await wajibPemilik('decline', claimedUserId);

  let poIdForRevalidate: string | null = null;
  // Untuk push stok ke Jubelio sesudah commit; diisi ulang tiap percobaan.
  let barangDibalik: string[] = [];
  let nomorGrn = '';

  // Serializable + diulang: dua tolak serentak dulu sama-sama lolos penjaga dan
  // membalik stok dua kali. Sekarang yang kalah diulang, melihat GRN sudah
  // ditolak, lalu berhenti sebelum menyentuh stok.
  await runSerializable(async (tx) => {
    poIdForRevalidate = null;
    barangDibalik = [];
    nomorGrn = '';
    const grn = await tx.gRN.findUnique({ where: { id } });
    if (!grn) throw new Error(PESAN_PEMILIK_GRN.TIDAK_DITEMUKAN);
    poIdForRevalidate = grn.poId ?? null;
    nomorGrn = grn.docNumber;
    if (grn.ownerDeclinedAt != null) {
      throw new Error(PESAN_PEMILIK_GRN.SUDAH_DITOLAK);
    }
    if (!grn.requiresOwnerApproval || grn.ownerApprovedAt != null) {
      throw new Error(PESAN_PEMILIK_GRN.TIDAK_MENUNGGU);
    }

    const lines = parseGrnStoredLines(grn.items);
    let reversedLines = 0;
    const rolls = await tx.fabricRoll.findMany({ where: { grnId: id } });
    for (const r of rolls) {
      if (Number(r.remainingLength) !== Number(r.initialLength)) {
        throw new Error(PESAN_PEMILIK_GRN.ROL_SUDAH_DIPAKAI);
      }
    }

    for (const line of lines) {
      const itemId = line.itemId;
      if (!itemId) continue;
      const qty = typeof line.qty === 'number' ? line.qty : Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const unitCost = typeof line.unitCost === 'number' ? line.unitCost : Number(line.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error(`${PESAN_PEMILIK_GRN.HARGA_TIDAK_SAH} ${itemId}`);
      }
      const variantKey = line.variantSku?.trim() ? line.variantSku.trim() : null;

      // OR-tolerant — reuses costing.ts's own lookup so this pre-check and reverseMovingAverage's
      // internal read below resolve the identical row (same deterministic orderBy tie-break),
      // rather than this strict spelling missing a real variantSku: null row and wrongly
      // reporting 0 on-hand for an item that has plenty.
      const inv = await findExistingInventoryValueRow(tx, itemId, variantKey);
      const onHand = inv ? new Decimal(inv.qtyOnHand.toString()) : new Decimal(0);
      if (onHand.lt(qty)) {
        throw new Error(PESAN_PEMILIK_GRN.STOK_KURANG);
      }

      await reverseMovingAverage(
        itemId,
        new Decimal(qty),
        new Decimal(unitCost),
        tx,
        variantKey,
        { refType: 'GRNReversal' satisfies StockLedgerRefType, refId: grn.id, refDocNumber: grn.docNumber, createdById: userId }
      );

      reversedLines += 1;
      barangDibalik.push(itemId);
    }

    if (reversedLines === 0) {
      throw new Error(PESAN_PEMILIK_GRN.TANPA_BARIS);
    }

    if (rolls.length > 0) {
      await tx.fabricRoll.deleteMany({ where: { grnId: id } });
    }

    if (grn.poId) {
      for (const line of lines) {
        const itemId = line.itemId;
        if (!itemId) continue;
        const qty = typeof line.qty === 'number' ? line.qty : Number(line.qty);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const variantKey = line.variantSku?.trim() ? line.variantSku.trim() : null;

        const poItem = await tx.pOItem.findFirst({
          where: {
            poId: grn.poId,
            itemId,
            variantSku: variantKey,
          },
        });
        if (!poItem) continue;
        const cur = Number(poItem.receivedQty);
        const next = cur - qty;
        if (next < 0) {
          throw new Error(PESAN_PEMILIK_GRN.QTY_PO_NEGATIF);
        }
        await tx.pOItem.update({
          where: { id: poItem.id },
          data: { receivedQty: next },
        });
      }

      const poItems = await tx.pOItem.findMany({ where: { poId: grn.poId } });
      // Received qty may not drop below what live vendor bills already charged for.
      const billed = await billedQtyByPoItem(tx, poItems.map((p) => p.id));
      if (poItems.some((p) => Number(p.receivedQty) < (billed.get(p.id) ?? 0) - 0.005)) {
        throw new Error('Cannot decline: vendor bills already charge for more than would stay received. Void those bills first.');
      }
      const newStatus = statusPoDariBaris(poItems);

      await tx.purchaseOrder.update({
        where: { id: grn.poId },
        data: { status: newStatus },
      });
      await tx.pOStatusHistory.create({
        data: {
          poId: grn.poId,
          status: newStatus,
          changedById: userId,
          notes: `GRN owner-declined: ${grn.docNumber}`,
        },
      });
    }

    await tx.gRN.update({
      where: { id },
      data: {
        requiresOwnerApproval: false,
        ownerDeclinedAt: new Date(),
        ownerDeclinedById: userId,
      },
    });

    if (grn.poId) {
      await recomputePaymentDueDate(tx, grn.poId);
    }
  });

  // Sesudah commit: stok yang dibalik dikirim ke Jubelio (best-effort).
  await antrekanPushStok(barangDibalik, { sumber: 'GRN_DECLINE', ref: nomorGrn, userId });

  try {
    const jr = await postGrnReversalJournal(id, userId);
    if (!jr.ok && jr.code !== "NOTHING_TO_POST") {
      const reversalJournalPendingNotification = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "GRN reversal journal not posted",
          message: `GRN reversal journal could not be posted (${jr.code}${jr.role ? `: ${jr.role}` : ""}). Map the account, then post from the GRN row.`,
          metadata: { grnId: id, kind: "reversal", reason: jr.code, role: jr.role ?? null },
        },
      });
      void fanOutAdminNotification(reversalJournalPendingNotification);
    }
  } catch (e) {
    try {
      const reversalJournalErrorNotification = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "GRN reversal journal not posted",
          message: `GRN journal errored (${e instanceof Error ? e.message : "unknown"}). Map/verify the account, then post from the GRN row.`,
          metadata: { grnId: id, kind: "reversal", reason: "ERROR", role: null },
        },
      });
      void fanOutAdminNotification(reversalJournalErrorNotification);
    } catch {
      // best-effort: a notification failure must never fail the decline
    }
  }

  revalidatePath('/backoffice/inventory');
  revalidatePath('/backoffice/purchase-orders');
  if (poIdForRevalidate) revalidatePath(`/backoffice/purchase-orders/${poIdForRevalidate}`);
}

export async function getGrnJournalState(grnId: string): Promise<{
  receiptJournalId: string | null;
  reversalJournalId: string | null;
  hasPostableReceiptJournal: boolean;
  hasPostableReversalJournal: boolean;
}> {
  await requireGrnRead();
  const [receipt, reversal, grn] = await Promise.all([
    prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN", sourceId: grnId } },
      select: { id: true },
    }),
    prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN_REVERSAL", sourceId: grnId } },
      select: { id: true },
    }),
    prisma.gRN.findUnique({ where: { id: grnId }, select: { totalAmount: true, ownerDeclinedAt: true } }),
  ]);
  const hasValue = grn != null && Math.abs(Number(grn.totalAmount)) >= 0.01;
  const declined = grn?.ownerDeclinedAt != null;
  return {
    receiptJournalId: receipt?.id ?? null,
    reversalJournalId: reversal?.id ?? null,
    /*
     * A declined receipt with no receipt journal booked nothing, so it gets
     * neither journal. The one exception is a declined receipt already carrying
     * a stray reversal with no receipt behind it: posting the receipt there nets
     * that reversal off.
     */
    hasPostableReceiptJournal: hasValue && receipt == null && (!declined || reversal != null),
    hasPostableReversalJournal: hasValue && declined && receipt != null && reversal == null,
  };
}

export async function postGrnReceiptJournalAction(
  grnId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" | "DITOLAK_PEMILIK" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const grn = await prisma.gRN.findUnique({ where: { id: grnId }, select: { id: true, ownerDeclinedAt: true } });
  if (!grn) return { ok: false, code: "BAD_STATE" };
  /*
   * Same rule as `getGrnJournalState`: a declined receipt is postable only to net off a stray
   * reversal. Otherwise its goods were already reversed out of inventory, and a receipt journal
   * would book a payable for goods never kept — and hold the PO payment at `GRN_REVERSAL_MISSING`.
   */
  if (grn.ownerDeclinedAt != null) {
    const reversal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "GRN_REVERSAL", sourceId: grnId } },
      select: { id: true },
    });
    if (!reversal) return { ok: false, code: "DITOLAK_PEMILIK" };
  }

  const r = await postGrnJournal(grnId, session.user.id);
  // Jurnal berdiri → tanda "Jurnal gagal" dokumen ini selesai (Beranda).
  if (r.ok) await tandaiJurnalTertundaSelesai([dokumenJurnal("GRN", grnId)]);
  revalidatePath("/backoffice/inventory");
  return r;
}

export async function postGrnReversalJournalAction(
  grnId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const grn = await prisma.gRN.findUnique({ where: { id: grnId }, select: { ownerDeclinedAt: true } });
  if (!grn || grn.ownerDeclinedAt == null) return { ok: false, code: "BAD_STATE" };

  const r = await postGrnReversalJournal(grnId, session.user.id);
  if (r.ok) await tandaiJurnalTertundaSelesai([dokumenJurnal("GRN_REVERSAL", grnId)]);
  revalidatePath("/backoffice/inventory");
  return r;
}

export type PutuskanGRNPemilikResult = { ok: true } | { ok: false; code: KodeTolakPemilikGrn };

/**
 * Setuju/tolak terima-lebih untuk layar, dengan penolakan sebagai KODE
 * (`inventory.grnPemilik.err.<kode>`): di build produksi Next menyamarkan
 * pesan lemparan aksi server, jadi layar dulu hanya bisa berkata "gagal".
 * Penjaga dan penulisnya tetap `approveGRNByOwner` / `declineGRNByOwner`.
 */
export async function putuskanGRNPemilik(
  id: string,
  keputusan: 'setuju' | 'tolak'
): Promise<PutuskanGRNPemilikResult> {
  const session = await auth();
  const perms = session?.user?.permissions ?? [];
  if (!session?.user?.id || !hasPermission(perms, PERMISSIONS.INVENTORY_MANAGE) || !perms.includes('*')) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  try {
    if (keputusan === 'setuju') await approveGRNByOwner(id);
    else await declineGRNByOwner(id);
    return { ok: true };
  } catch (e) {
    const code = kodeTolakPemilikGrn(e);
    if (code === 'GAGAL') console.error('[putuskanGRNPemilik]', e);
    return { ok: false, code };
  }
}

export type RincianGRN = {
  id: string;
  docNumber: string;
  grnDate: string;
  createdAt: string;
  supplier: { id: string; code: string; name: string };
  po: { id: string; docNumber: string; status: string } | null;
  penerima: string | null;
  totalAmount: number;
  /** PPN masukan tersimpan (`lib/finance/pajak/grn-ppn.ts`); null/0 = tanpa PPN dipisah. */
  ppnAmount: number | null;
  notes: string | null;
  foto: string[];
  baris: BarisRincianGrn[];
  pemilik: {
    keadaan: 'menunggu' | 'disetujui' | 'ditolak' | null;
    waktu: string | null;
    oleh: string | null;
  };
  rolls: Awaited<ReturnType<typeof getRollsByGrnId>>;
  returPemasok: Array<{ id: string; docNumber: string; status: string }>;
};

/**
 * Rincian satu GRN untuk halaman `/backoffice/inventory/grn/[id]`: barang,
 * qty, harga, foto, keadaan terima-lebih, roll kain, retur pemasok terkait.
 * Dulu baris GRN di tab Penerimaan Barang hanya bisa dibuka untuk roll kain.
 */
export async function getRincianGRN(id: string): Promise<RincianGRN | null> {
  await requireGrnRead();
  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      po: { select: { id: true, docNumber: true, status: true } },
      ownerApprovedBy: { select: { name: true, email: true } },
      ownerDeclinedBy: { select: { name: true, email: true } },
      vendorReturns: { select: { id: true, docNumber: true, status: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!grn) return null;

  const mentah = parseGrnStoredLines(grn.items);
  const idBarang = [...new Set(mentah.map((l) => l.itemId).filter((v): v is string => typeof v === 'string' && v !== ''))];
  const [barangRows, penerima, rolls] = await Promise.all([
    idBarang.length
      ? prisma.item.findMany({
          where: { id: { in: idBarang } },
          select: { id: true, sku: true, nameId: true, variants: true, uom: { select: { code: true } } },
        })
      : Promise.resolve([]),
    grn.receivedBy
      ? prisma.user.findUnique({ where: { id: grn.receivedBy }, select: { name: true, email: true } })
      : Promise.resolve(null),
    getRollsByGrnId(id),
  ]);
  const barang = new Map<string, BarangGrn>(
    barangRows.map((b) => [b.id, { sku: b.sku, nameId: b.nameId, uomCode: b.uom?.code ?? '', variants: b.variants }])
  );
  const keadaan = keadaanPemilikGrn(grn);
  const pemutus = keadaan === 'ditolak' ? grn.ownerDeclinedBy : keadaan === 'disetujui' ? grn.ownerApprovedBy : null;

  return {
    id: grn.id,
    docNumber: grn.docNumber,
    grnDate: grn.grnDate.toISOString(),
    createdAt: grn.createdAt.toISOString(),
    supplier: grn.supplier,
    po: grn.po,
    penerima: penerima ? penerima.name || penerima.email || null : null,
    totalAmount: Number(grn.totalAmount),
    ppnAmount: grn.ppnAmount == null ? null : Number(grn.ppnAmount),
    notes: grn.notes,
    foto: fotoGrn(grn.photoUrls),
    baris: susunBarisGrn(grn.items, barang),
    pemilik: {
      keadaan,
      waktu:
        keadaan === 'ditolak'
          ? grn.ownerDeclinedAt?.toISOString() ?? null
          : keadaan === 'disetujui'
            ? grn.ownerApprovedAt?.toISOString() ?? null
            : null,
      oleh: pemutus ? pemutus.name || pemutus.email || null : null,
    },
    rolls,
    returPemasok: grn.vendorReturns,
  };
}

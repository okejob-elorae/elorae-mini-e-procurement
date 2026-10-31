'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { relinkPoItems, unlinkPoItems } from '@/lib/item-requests/mutations';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { assertActor } from "@/lib/auth/assert-actor";
import { z } from 'zod';
import { notifyPOCreated, notifyPOStatusUpdated, notifyPOPaymentToggled } from '@/lib/notifications/events';
import { getActorName } from "@/lib/notifications/actor-name";
import { createPurchaseOrder, type POFormData } from '@/lib/purchase-orders/mutations';
import { pastikanTahapAda, tahapKiriman, TahapTidakAdaError } from '@/lib/purchase-orders/tahap';
import { listPOs, getPOById as getPOByIdQuery } from '@/lib/purchase-orders/queries';
import { assertLinesVariantSkusMatchItemDefinitions } from '@/lib/items/validate-variant-lines';
import { resolvePoLeadTimeFields } from '@/lib/leadtime/po-snapshot';
import { parsePaymentTermsDays, resolveManualPaymentDueDate } from "@/lib/purchase-orders/payment-terms";
import { recomputePaymentDueDate } from "@/lib/purchase-orders/payment-due";
import { setPurchaseOrderPaymentTerms, type SetPaymentTermsCode } from "@/lib/purchase-orders/set-payment-terms";
import {
  hasCurrentPaymentJournal,
  hasStandingPaymentJournalWhileUnpaid,
  postSupplierPaymentJournal,
  postSupplierPaymentReversalJournal,
} from '@/lib/purchasing/supplier-payment-journal';
import type { GenerateAutoJournalResult } from '@/lib/finance/journal';
import {
  attemptSupplierPaymentJournal,
  latestPaymentJournalFailure,
  notifySupplierPaymentJournalFailure,
  type SupplierPaymentPostFailure,
} from '@/lib/purchasing/post-supplier-payment-journal-safely';
import {
  isReceiptBlockedMarkCode,
  type ReceiptBlockedMarkCode,
  type SupplierPaymentDirection,
} from "@/lib/purchasing/supplier-payment-journal-message";
import { adaPembayaranDokumenUntukPo, selaraskanCerminTandaiLunas } from '@/lib/purchasing/pembayaran-tandai-lunas';
import { tandaiJurnalTertundaSelesai, type SumberNotifikasiJurnal } from '@/lib/finance/jurnal-tertunda';
import { runSerializable } from '@/lib/db/tx-retry';
import { tanggalBayarSah } from '@/app/backoffice/supplier-payments/tanggal-bayar';
import { keadaanPemilikGrn } from '@/app/backoffice/inventory/grn/[id]/rincian-grn';
import { hitungTotalPo } from '@/lib/purchase-orders/ppn';
import {
  PESAN_TOLAK_TUTUP_PO,
  tutupPurchaseOrder,
  type HasilTutupPo,
} from '@/lib/purchase-orders/tutup';
import {
  PESAN_TOLAK_BATAL_PO,
  batalkanPurchaseOrder,
  type KodeTolakBatalPo,
} from '@/lib/purchase-orders/batal';

function poReceiptLineKey(itemId: string, variantSku?: string | null) {
  return `${itemId}\n${variantSku ?? ''}`;
}

/*
 * Pelaku setiap tulisan PO (`createdById`, `changedById`, nama di notifikasi)
 * diambil dari SESI. Argumen `claimedUserId` di aksi-aksi di bawah dipertahankan
 * supaya pemanggil lama tidak berubah; kalau dikirim, harus sama dengan pengguna
 * sesi (`assertActor`). Dulu nilainya ditulis apa adanya, jadi pemegang izin PO
 * bisa mencatat persetujuan atau pembatalan atas nama orang lain di riwayat status.
 */
/**
 * Hasil `createPO`. Penolakan tahap DIKEMBALIKAN sebagai kode (pesan lemparan
 * aksi server disamarkan di build produksi); galat lama (izin, validasi) masih
 * dilempar seperti sebelumnya.
 */
export type CreatePOResult =
  | { ok: true; id: string; docNumber: string }
  /** `planStageId` menunjuk tahap produksi yang sudah tidak ada. */
  | { ok: false; code: 'TAHAP_TIDAK_ADA' };

export async function createPO(data: POFormData, claimedUserId?: string): Promise<CreatePOResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE);
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  let po;
  try {
    po = await createPurchaseOrder(data, userId);
  } catch (error) {
    if (error instanceof TahapTidakAdaError) return { ok: false, code: 'TAHAP_TIDAK_ADA' };
    if (error instanceof z.ZodError) {
      throw new Error(error.issues[0]?.message ?? 'Invalid purchase order data');
    }
    throw error;
  }

  getActorName(userId)
    .then((triggeredByName) => notifyPOCreated(po.id, po.docNumber, triggeredByName))
    .catch(() => {});

  if (po.planStageId) revalidatePath(`/backoffice/production/planning/tahap/${po.planStageId}`);
  return { ok: true, id: po.id, docNumber: po.docNumber };
}

/*
 * Penolakan edit PO DIKEMBALIKAN sebagai `{ ok:false, code }`: di build
 * produksi Next menyamarkan pesan lemparan aksi server, jadi layar edit PO
 * hanya bisa menjelaskan alasannya lewat kode (`purchaseOrders.edit.err.*`).
 * Di dalam transaksi penolakan tetap DILEMPAR (`EditPoDitolak`) supaya semua
 * tulisan batal, lalu diterjemahkan di luar.
 */
export type KodeTolakEditPo =
  | 'TIDAK_DITEMUKAN'
  | 'PO_TERTUTUP'
  | 'PIN_WAJIB'
  | 'TAHAP_TIDAK_ADA'
  /** Termin pembayaran bukan bilangan bulat 0–365 hari. */
  | 'TERMIN_TIDAK_SAH'
  /** PO sudah dibayar: terminnya tidak bisa diubah lagi. */
  | 'TERMIN_SUDAH_LUNAS'
  /** PO sudah ditagih lewat Vendor Billing: batalkan tagihannya dulu sebelum mengubah PO. */
  | 'SUDAH_DITAGIH';

export type UpdatePOResult =
  | { ok: true; id: string }
  | { ok: false; code: KodeTolakEditPo | 'TANPA_AKSES' | 'GAGAL' }
  /** `barang` = SKU (atau id) dari pemeriksa varian. */
  | { ok: false; code: 'VARIAN_TIDAK_VALID'; barang: string }
  /** Baris dengan barang sudah diterima dihapus atau qty-nya di bawah `diterima`. */
  | { ok: false; code: 'QTY_DI_BAWAH_DITERIMA'; barang: string; diterima: number }
  /** `kunciPesan` = kunci `security.*` dari pemeriksa PIN (mis. `pinIncorrect`). */
  | { ok: false; code: 'PIN_DITOLAK'; kunciPesan: string };

type TolakEditPo = Exclude<Extract<UpdatePOResult, { ok: false }>, { code: 'TANPA_AKSES' | 'GAGAL' | 'PIN_DITOLAK' }>;

class EditPoDitolak extends Error {
  constructor(readonly hasil: TolakEditPo) {
    super(hasil.code);
    this.name = 'EditPoDitolak';
  }
}

/*
 * Pesan pasti `assertLinesVariantSkusMatchItemDefinitions` (lib/items/
 * validate-variant-lines.ts) → SKU/id barangnya. Galat lain (mis. konflik
 * serializable) tidak cocok dan dilempar apa adanya.
 */
const POLA_TOLAK_VARIAN = [
  /^Select a valid variant for item (.+)$/,
  /^Item (.+) has no variants; clear variant selection$/,
  /^Item not found: (.+)$/,
];

function barangVarianDitolak(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  for (const pola of POLA_TOLAK_VARIAN) {
    const m = error.message.match(pola);
    if (m) return m[1];
  }
  return null;
}

/** CLOSED (lengkap atau "Tutup PO") dan CANCELLED tidak bisa diedit. */
const STATUS_TIDAK_BISA_DIEDIT: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);
const STATUS_JAGA_DITERIMA: ReadonlySet<string> = new Set(['SUBMITTED', 'PARTIAL', 'OVER']);

/*
 * Edit PO. Baca status + tulis berada dalam SATU `runSerializable` dengan
 * penjaga status: dulu status dibaca di luar transaksi dan ditulis di
 * `$transaction` biasa, jadi edit yang kalah cepat dari "Tutup PO", pembatalan
 * atau GRN menulis ulang baris/total PO yang sudah ditutup/batal (atau menimpa
 * qty diterima). Sekarang yang kalah konflik, diulang, dan melihat keadaan baru.
 *
 * Baca awal di luar transaksi HANYA untuk memutuskan perlu PIN: pemeriksa PIN
 * mencatat percobaan, jadi tidak boleh ikut diulang transaksi.
 */
export async function updatePO(
  id: string,
  data: POFormData,
  claimedUserId?: string,
  pin?: string
): Promise<UpdatePOResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.PURCHASE_ORDERS_EDIT)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  try {
    const awal = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!awal) return { ok: false, code: 'TIDAK_DITEMUKAN' };
    if (STATUS_TIDAK_BISA_DIEDIT.has(awal.status)) return { ok: false, code: 'PO_TERTUTUP' };

    let pinTerverifikasi = false;
    if (awal.status !== 'DRAFT') {
      if (!pin) return { ok: false, code: 'PIN_WAJIB' };
      const pinResult = await verifyPinForAction(userId, pin, 'EDIT_POSTED_PO');
      if (!pinResult.success) {
        return { ok: false, code: 'PIN_DITOLAK', kunciPesan: pinResult.messageKey ?? 'pinInvalid' };
      }
      pinTerverifikasi = true;
    }

    let termsPatch: { paymentTermsDays?: number | null } = {};
    if (data.paymentTermsDays !== undefined) {
      const parsedTerms = parsePaymentTermsDays(data.paymentTermsDays);
      if (!parsedTerms.ok) return { ok: false, code: 'TERMIN_TIDAK_SAH' };
      termsPatch = { paymentTermsDays: parsedTerms.value };
    }

    await tulisEditPo(id, data, userId, pinTerverifikasi, termsPatch);
  } catch (error) {
    if (error instanceof EditPoDitolak) return error.hasil;
    console.error('[updatePO]', error);
    return { ok: false, code: 'GAGAL' };
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return { ok: true, id };
}

async function tulisEditPo(
  id: string,
  data: POFormData,
  userId: string,
  pinTerverifikasi: boolean,
  termsPatch: { paymentTermsDays?: number | null }
) {
  return runSerializable(async (tx) => {
    // The items are rebuilt below, which would orphan the lines of a vendor bill on them. The PO
    // row lock is the one createVendorBill takes, so a bill cannot commit between check and rebuild.
    await tx.$queryRaw`SELECT \`id\` FROM \`PurchaseOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { status: true, ppnRatePercent: true, planStageId: true, paidAt: true, paymentTermsDays: true },
    });
    if (!existing) throw new EditPoDitolak({ ok: false, code: 'TIDAK_DITEMUKAN' });
    if (STATUS_TIDAK_BISA_DIEDIT.has(existing.status)) throw new EditPoDitolak({ ok: false, code: 'PO_TERTUTUP' });
    // DRAFT yang dikirim ke pemasok di tengah edit tanpa PIN: tetap butuh PIN.
    if (existing.status !== 'DRAFT' && !pinTerverifikasi) throw new EditPoDitolak({ ok: false, code: 'PIN_WAJIB' });
    if (
      existing.paidAt != null &&
      termsPatch.paymentTermsDays !== undefined &&
      termsPatch.paymentTermsDays !== existing.paymentTermsDays
    ) {
      throw new EditPoDitolak({ ok: false, code: 'TERMIN_SUDAH_LUNAS' });
    }
    const billed = await tx.vendorBillLine.count({ where: { poItem: { poId: id }, bill: { status: { not: 'VOID' } } } });
    if (billed > 0) throw new EditPoDitolak({ ok: false, code: 'SUDAH_DITAGIH' });
    const preserveReceived = STATUS_JAGA_DITERIMA.has(existing.status);

    try {
      await assertLinesVariantSkusMatchItemDefinitions(tx.item, data.items);
    } catch (error) {
      const barang = barangVarianDitolak(error);
      if (barang == null) throw error;
      throw new EditPoDitolak({ ok: false, code: 'VARIAN_TIDAK_VALID', barang });
    }

    // Tahap produksi: `undefined` = tidak disentuh, `null`/'' = dilepas. Tahap
    // yang sama dengan yang tersimpan tidak diperiksa ulang — edit biasa tidak
    // boleh gagal karena tahapnya; tahap BARU harus ada.
    const tahapBaru = tahapKiriman(data.planStageId);
    if (tahapBaru && tahapBaru !== existing.planStageId) {
      try {
        await pastikanTahapAda(tx, tahapBaru);
      } catch (error) {
        if (error instanceof TahapTidakAdaError) throw new EditPoDitolak({ ok: false, code: 'TAHAP_TIDAK_ADA' });
        throw error;
      }
    }

    const oldItems = await tx.pOItem.findMany({
      where: { poId: id },
      select: { itemId: true, variantSku: true, receivedQty: true, item: { select: { nameId: true, sku: true } } },
    });
    const receivedByLine = new Map<string, number>();
    const namaByLine = new Map<string, string>();
    for (const o of oldItems) {
      const r = Number(o.receivedQty);
      const k = poReceiptLineKey(o.itemId, o.variantSku);
      receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + r);
      const nama = o.item?.nameId || o.item?.sku || o.itemId;
      namaByLine.set(k, o.variantSku ? `${nama} (${o.variantSku})` : nama);
    }

    if (preserveReceived) {
      for (const [key, recv] of receivedByLine) {
        if (recv <= 0) continue;
        const lines = data.items.filter(
          (i) => poReceiptLineKey(i.itemId, i.variantSku ?? null) === key
        );
        const totalNewQty = lines.reduce((s, i) => s + i.qty, 0);
        if (lines.length === 0 || totalNewQty < recv) {
          throw new EditPoDitolak({
            ok: false,
            code: 'QTY_DI_BAWAH_DITERIMA',
            barang: namaByLine.get(key) ?? key,
            diterima: recv,
          });
        }
      }
    }
    // Tarif PPN yang tersimpan di PO, bukan tarif Pengaturan hari ini; PO lama
    // (tarif kosong) tetap tanpa PPN — nilainya tidak berubah karena diedit.
    const tarifPo = existing.ppnRatePercent == null ? null : Number(existing.ppnRatePercent);
    const total = hitungTotalPo(data.items, tarifPo);

    await unlinkPoItems(tx, id);
    await tx.pOItem.deleteMany({ where: { poId: id } });

    const remainingRecv = new Map(receivedByLine);
    const itemCreates = data.items.map((item) => {
      const k = poReceiptLineKey(item.itemId, item.variantSku ?? null);
      const avail = remainingRecv.get(k) ?? 0;
      const receivedQty = preserveReceived ? Math.min(avail, item.qty) : 0;
      remainingRecv.set(k, Math.max(0, avail - receivedQty));
      return {
        itemId: item.itemId,
        variantSku: item.variantSku?.trim() || null,
        qty: item.qty,
        price: item.price,
        ppnIncluded: item.ppnIncluded,
        uomId: item.uomId,
        notes: item.notes ?? null,
        receivedQty,
      };
    });

    let leadTimePatch: {
      chainSnapshot?: object | null;
      chainTotalDays?: number | null;
      etaDate?: Date | null;
    } = {};
    if (existing.status === "DRAFT") {
      const lt = await resolvePoLeadTimeFields(
        tx,
        data.supplierId,
        data.items,
        data.etaDate ?? null
      );
      leadTimePatch = {
        chainSnapshot: lt.chainSnapshot,
        chainTotalDays: lt.chainTotalDays,
        etaDate: lt.etaDate ?? null,
      };
    }

    const currentTerms = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { paymentTermsDays: true },
    });
    const effectiveTerms =
      termsPatch.paymentTermsDays !== undefined
        ? termsPatch.paymentTermsDays
        : currentTerms?.paymentTermsDays ?? null;

    const po = await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        etaDate: leadTimePatch.etaDate !== undefined ? leadTimePatch.etaDate : data.etaDate,
        ...termsPatch,
        paymentDueDate: resolveManualPaymentDueDate(effectiveTerms, data.paymentDueDate),
        notes: data.notes,
        terms: data.terms,
        ...(tahapBaru !== undefined ? { planStageId: tahapBaru } : {}),
        totalAmount: total.subtotal,
        taxAmount: total.taxAmount,
        grandTotal: total.grandTotal,
        ...(existing.status === "DRAFT"
          ? {
              chainSnapshot: leadTimePatch.chainSnapshot ?? undefined,
              chainTotalDays: leadTimePatch.chainTotalDays ?? undefined,
            }
          : {}),
        items: { create: itemCreates },
      },
      include: {
        items: { include: { item: true } },
        supplier: true,
      },
    });
    await relinkPoItems(tx, id);

    if (existing.status !== 'DRAFT') {
      await tx.pOStatusHistory.create({
        data: {
          poId: id,
          status: existing.status,
          changedById: userId,
          notes: 'PO Edited (PIN verified)',
        },
      });
    }

    await recomputePaymentDueDate(tx, id);

    return po;
  });
}

export async function setPOPaymentTerms(
  poId: string,
  paymentTermsDays: number | null,
  pin?: string
): Promise<{ ok: true } | { ok: false; code: SetPaymentTermsCode | "PIN"; message?: string }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { status: true },
  });
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  if (existing.status !== "DRAFT") {
    if (!pin) return { ok: false, code: "PIN", message: "PIN required" };
    const pinResult = await verifyPinForAction(session.user.id, pin, "EDIT_POSTED_PO");
    if (!pinResult.success) {
      return { ok: false, code: "PIN", message: pinResult.messageKey ?? pinResult.message };
    }
  }

  const result = await setPurchaseOrderPaymentTerms(poId, paymentTermsDays, session.user.id);
  if (result.ok) {
    revalidatePath("/backoffice/purchase-orders");
    revalidatePath(`/backoffice/purchase-orders/${poId}`);
  }
  return result;
}

export async function changePOStatus(
  id: string,
  newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED',
  claimedUserId?: string,
  notes?: string,
  pin?: string
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  const userId = session.user.id;
  // Mengirim ke pemasok dan menutup PO sama-sama keputusan approver; dulu
  // CLOSED cukup `edit` dan tanpa alasan — pintu belakang "Tutup PO".
  if (newStatus === 'SUBMITTED' || newStatus === 'CLOSED') {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_APPROVE);
  } else {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  }
  if (claimedUserId) assertActor(session.user.id, claimedUserId);

  if (newStatus === 'CLOSED') {
    // Satu jalur penutupan: alasan wajib, jejak AuditLog, runSerializable.
    const hasil = await tutupPurchaseOrder({ poId: id, userId, alasan: notes ?? '' });
    if (!hasil.ok) throw new Error(PESAN_TOLAK_TUTUP_PO[hasil.code]);
    kabariPoDitutup(id, hasil.docNumber, hasil.statusSebelum, userId);
    revalidatePath('/backoffice/purchase-orders');
    revalidatePath(`/backoffice/purchase-orders/${id}`);
    return { id, status: 'CLOSED' as const };
  }

  if (newStatus === 'CANCELLED') {
    if (!pin) {
      throw new Error('PIN required to void/cancel a PO');
    }
    const pinResult = await verifyPinForAction(session.user.id, pin, 'VOID_DOCUMENT');
    if (!pinResult.success) {
      throw new Error(pinResult.messageKey ?? pinResult.message);
    }
    // Penjaga "belum ada GRN" + tulis CANCELLED dalam satu transaksi serializable.
    const hasil = await batalkanPurchaseOrder({
      poId: id,
      userId,
      alasan: notes || 'Status changed to CANCELLED',
    });
    if (!hasil.ok) throw galatTolakBatalPo(hasil.code);
    kabariPoDibatalkan(id, hasil.docNumber, hasil.statusSebelum, userId);
    revalidatePath('/backoffice/purchase-orders');
    revalidatePath(`/backoffice/purchase-orders/${id}`);
    return { id, status: 'CANCELLED' as const };
  }

  // Penjaga DRAFT dan tulisnya satu transaksi serializable: "kirim" yang membaca
  // DRAFT lalu kalah cepat dari pembatalan tidak boleh menghidupkan PO batal.
  const { existing, po } = await runSerializable(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { status: true, docNumber: true },
    });
    if (!existing) throw new Error('PO not found');
    // PO tertutup (lengkap atau "Tutup PO") tidak boleh dibuka lagi lewat "kirim".
    if (newStatus === 'SUBMITTED' && existing.status !== 'DRAFT') {
      throw new Error('Hanya PO draf yang bisa dikirim ke pemasok.');
    }

    const po = await tx.purchaseOrder.update({
      where: { id },
      data: { status: newStatus }
    });

    await tx.pOStatusHistory.create({
      data: {
        poId: id,
        status: newStatus,
        changedById: userId,
        notes: notes || `Status changed to ${newStatus}`
      }
    });
    return { existing, po };
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyPOStatusUpdated(id, existing.docNumber, existing.status, newStatus, triggeredByName)
    )
    .catch(() => {});
  
  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return { id: po.id, status: po.status };
}

function kabariPoDitutup(id: string, docNumber: string, statusSebelum: string, userId: string) {
  getActorName(userId)
    .then((triggeredByName) => notifyPOStatusUpdated(id, docNumber, statusSebelum, 'CLOSED', triggeredByName))
    .catch(() => {});
}

function kabariPoDibatalkan(id: string, docNumber: string, statusSebelum: string, userId: string) {
  getActorName(userId)
    .then((triggeredByName) => notifyPOStatusUpdated(id, docNumber, statusSebelum, 'CANCELLED', triggeredByName))
    .catch(() => {});
}

/** Untuk layar lama yang hanya menangkap lemparan: pesan terbaca + `code`. */
function galatTolakBatalPo(code: KodeTolakBatalPo): Error & { code: KodeTolakBatalPo } {
  return Object.assign(new Error(PESAN_TOLAK_BATAL_PO[code]), { code });
}

export type TutupPOResult = HasilTutupPo | { ok: false; code: 'TANPA_AKSES' | 'GAGAL' };

/**
 * "Tutup PO" untuk PO kurang kirim. Butuh `purchase_orders:approve`; pelaku dari
 * sesi. Penolakan dikembalikan sebagai `{ ok:false, code }` (lihat
 * `KodeTolakTutupPo`), tidak dilempar.
 */
export async function tutupPO(id: string, alasan: string): Promise<TutupPOResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_APPROVE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  const userId = session.user.id;
  let hasil: HasilTutupPo;
  try {
    hasil = await tutupPurchaseOrder({ poId: id, userId, alasan });
  } catch (error) {
    console.error('[tutupPO]', error);
    return { ok: false, code: 'GAGAL' };
  }
  if (hasil.ok) {
    kabariPoDitutup(id, hasil.docNumber, hasil.statusSebelum, userId);
    revalidatePath('/backoffice/purchase-orders');
    revalidatePath(`/backoffice/purchase-orders/${id}`);
  }
  return hasil;
}

export async function submitPO(id: string, claimedUserId?: string) {
  // Pelakunya dibaca `changePOStatus` dari sesi; `claimedUserId` hanya diperiksa di sana.
  return changePOStatus(id, 'SUBMITTED', claimedUserId, 'PO Submitted to supplier');
}

export async function cancelPO(id: string, claimedUserId?: string, reason?: string, pin?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  if (!pin) {
    throw new Error('PIN required to cancel/void a PO');
  }
  const pinResult = await verifyPinForAction(session.user.id, pin, 'VOID_DOCUMENT');
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message);
  }

  // Penjaga "belum ada GRN" + tulis CANCELLED dalam satu transaksi serializable.
  const hasil = await batalkanPurchaseOrder({ poId: id, userId, alasan: reason || 'PO Cancelled' });
  if (!hasil.ok) throw galatTolakBatalPo(hasil.code);
  kabariPoDibatalkan(id, hasil.docNumber, hasil.statusSebelum, userId);

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
}

export type BatalkanPOResult =
  | { ok: true }
  | { ok: false; code: KodeTolakBatalPo | 'TANPA_AKSES' | 'ALASAN_WAJIB' | 'PIN_WAJIB' | 'GAGAL' }
  /** `kunciPesan` = kunci `security.*` dari pemeriksa PIN (mis. `pinInvalid`). */
  | { ok: false; code: 'PIN_DITOLAK'; kunciPesan: string };

/**
 * Batalkan PO (PIN wajib) dengan penolakan sebagai `{ ok:false, code }`, bukan
 * lemparan — di build produksi Next menyamarkan pesan lemparan aksi server,
 * jadi layar hanya bisa menjelaskan penolakan lewat kode. Butuh
 * `purchase_orders:edit`; pelaku dari sesi.
 */
export async function batalkanPO(id: string, alasan: string, pin: string): Promise<BatalkanPOResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  const userId = session.user.id;
  // Alasan wajib: dulu daftar PO mengirim teks Inggris tetap tanpa bertanya.
  const alasanBersih = (alasan ?? '').trim();
  if (!alasanBersih) return { ok: false, code: 'ALASAN_WAJIB' };
  if (!pin) return { ok: false, code: 'PIN_WAJIB' };

  try {
    const pinResult = await verifyPinForAction(userId, pin, 'VOID_DOCUMENT');
    if (!pinResult.success) {
      return { ok: false, code: 'PIN_DITOLAK', kunciPesan: pinResult.messageKey ?? 'pinInvalid' };
    }
    const hasil = await batalkanPurchaseOrder({ poId: id, userId, alasan: alasanBersih });
    if (!hasil.ok) return hasil;
    kabariPoDibatalkan(id, hasil.docNumber, hasil.statusSebelum, userId);
  } catch (error) {
    console.error('[batalkanPO]', error);
    return { ok: false, code: 'GAGAL' };
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return { ok: true };
}

/**
 * Siapa yang sah membaca PO, menurut halaman pemanggilnya: halaman PO
 * (`purchase_orders:view`), pembayaran pemasok (`supplier_payments:view`),
 * formulir GRN (`inventory:manage`), dan formulir WO baru/ubah
 * (`work_orders:create` / `work_orders:manage`).
 */
const IZIN_BACA_PO = [
  PERMISSIONS.PURCHASE_ORDERS_VIEW,
  PERMISSIONS.SUPPLIER_PAYMENTS_VIEW,
  PERMISSIONS.INVENTORY_MANAGE,
  PERMISSIONS.WORK_ORDERS_CREATE,
  PERMISSIONS.WORK_ORDERS_MANAGE,
];

/** Penjaga baca: sesi + salah satu izin (melempar seperti `requirePermission`). */
async function wajibSalahSatuIzin(codes: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  const perms = session.user.permissions ?? [];
  if (!codes.some((c) => hasPermission(perms, c))) requirePermission(perms, codes[0]);
}

export async function getPOs(
  filters?: Parameters<typeof listPOs>[0],
  opts?: Parameters<typeof listPOs>[1],
  extras?: Parameters<typeof listPOs>[2]
) {
  await wajibSalahSatuIzin(IZIN_BACA_PO);
  return listPOs(filters, opts, extras);
}

export async function getPOById(id: string) {
  await wajibSalahSatuIzin(IZIN_BACA_PO);
  const po = await getPOByIdQuery(id);
  if (!po) return null;
  // Rekening pemasok terenkripsi tidak pernah dikirim ke browser.
  const { bankAccountEnc: _rekening, ...supplier } = po.supplier;
  void _rekening;
  // Keadaan terima-lebih tiap GRN untuk kartu "Penerimaan barang": GRN yang
  // ditolak pemilik sudah dibalik dan tidak boleh tampil seperti penerimaan biasa.
  const keadaanGrn = po.grns.length
    ? await prisma.gRN.findMany({
        where: { id: { in: po.grns.map((g) => g.id) } },
        select: { id: true, requiresOwnerApproval: true, ownerApprovedAt: true, ownerDeclinedAt: true },
      })
    : [];
  const perGrn = new Map(keadaanGrn.map((g) => [g.id, keadaanPemilikGrn(g)]));
  const grns = po.grns.map((g) => ({ ...g, keadaanPemilik: perGrn.get(g.id) ?? null }));
  return { ...po, grns, supplier };
}

/** Pemasok untuk pemilih di formulir dokumen lama dan saringan (bukan PO baru). */
export type PemasokPilihan = { id: string; code: string; name: string; disetujui: boolean };

/**
 * Pemilih pemasok untuk saringan dan dokumen yang SUDAH ada (GRN, register
 * pembayaran, ubah retur, ubah PO): pemasok yang disetujui ATAU yang punya
 * dokumen (PO, GRN, retur pemasok), ditambah `sertakanId` (pemasok dokumen
 * yang sedang diubah). `approvedOnly` dulu dipakai di sini juga, jadi saringan
 * tidak bisa memilih pemasok PO yang belum dibayar dan formulir ubah retur
 * kehilangan pemasoknya sendiri. PO BARU tetap hanya untuk pemasok disetujui.
 */
export async function getPemasokPilihan(sertakanId?: string[]): Promise<PemasokPilihan[]> {
  await wajibSalahSatuIzin([
    ...IZIN_BACA_PO,
    PERMISSIONS.PURCHASE_ORDERS_EDIT,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.VENDOR_RETURNS_VIEW,
  ]);
  const sertakan = (sertakanId ?? []).filter((id) => typeof id === 'string' && id.length > 0).slice(0, 50);
  const rows = await prisma.supplier.findMany({
    where: {
      OR: [
        { status: 'ACTIVE' },
        { purchaseOrders: { some: {} } },
        { grns: { some: {} } },
        { vendorReturns: { some: {} } },
        ...(sertakan.length > 0 ? [{ id: { in: sertakan } }] : []),
      ],
    },
    select: { id: true, code: true, name: true, status: true },
    orderBy: [{ name: 'asc' }, { code: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, disetujui: r.status === 'ACTIVE' }));
}

// Get PO statistics for dashboard
export async function getPOStats() {
  await wajibSalahSatuIzin([PERMISSIONS.PURCHASE_ORDERS_VIEW]);
  const [
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue
  ] = await Promise.all([
    prisma.purchaseOrder.count(),
    prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }),
    prisma.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.purchaseOrder.count({
      where: {
        etaDate: { lt: new Date() },
        status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
      }
    }),
    prisma.purchaseOrder.aggregate({
      _sum: { grandTotal: true }
    })
  ]);
  
  return {
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue: Number(totalValue._sum.grandTotal ?? 0),
  };
}

/**
 * What the toggle did to the ledger, so the caller can tell the operator instead
 * of reporting success for a payment nothing was posted for.
 *
 * `changed` is the compare-and-swap's own verdict: false means the PO was
 * ALREADY in the requested state, so no `paidAt` write, no status history, no
 * notification and — critically — no journal happened. It has to cross to the
 * client because a no-op is otherwise indistinguishable from a real toggle, and
 * the two states where it matters are exactly the dangerous ones: a first mark
 * that committed `paidAt` but failed to post, then re-marked from a stale tab,
 * would be reported as a clean payment while the ledger gap persists.
 *
 * `refusal` is a THIRD outcome, deliberately not folded into either of the other
 * two, and — `ADA_PEMBAYARAN_DOKUMEN` aside — only ever on a MARK. Nothing at all
 * is written for it — no `paidAt`, no journal, no status history, no
 * notification. It comes in these kinds:
 *
 * - `TANGGAL_TIDAK_SAH`: the paid date is after today (WIB). The payment journal
 *   is dated `paidAt`, so a future date would put the cash-out in a period that
 *   has not happened. Refused before the transaction opens.
 * - `STANDING_PAYMENT_JOURNAL`: refused BEFORE the compare-and-swap while the PO
 *   reads unpaid with a payment journal still standing at its current
 *   generation, so no post is reached at all.
 * - `BILLED_VIA_VENDOR_BILL`: the PO has lines on a live vendor bill, which is
 *   paid from the bill (Vendor Bills → payments); refused before the
 *   compare-and-swap.
 * - `ADA_PEMBAYARAN_DOKUMEN`: the PO is already (partly) paid through supplier
 *   payment documents (Supplier payments → Pay). This button pays the PO's WHOLE
 *   payable from the ledger, so the settled part would be paid twice; removing
 *   its mark does not cancel those documents either. Refused before the
 *   compare-and-swap in BOTH directions — the rest is paid, or the payment
 *   cancelled, from the Supplier payments page. The payment writer refuses it
 *   too, for the paths that do not pass through here.
 * - a `ReceiptBlockedMarkCode` (`GRN_APPROVAL_PENDING`, `GRN_JOURNALS_INCOMPLETE`,
 *   `GRN_REVERSAL_MISSING`): the post WAS reached and refused because one of the
 *   PO's receipts is not settled yet, and the whole transaction is rolled back,
 *   the compare-and-swap with it. The PO is not payable until that receipt is
 *   sorted out, so the mark is aborted rather than committed with a
 *   `JOURNAL_PENDING` the operator would then have to clear.
 *
 * Reporting any of them as `changed: false` would be wrong in both directions: the
 * no-op message says the PO was already in the requested state (it was not) and
 * offers unmark-then-re-mark as the remedy (which reaches neither the missing
 * reversal nor the unsettled receipt). Each needs its own message naming the
 * document that blocks the mark and the control that clears it.
 *
 * `journalFailure` is null on the happy path, on a no-op (nothing was attempted),
 * on a refusal (either nothing was posted or what was attempted was rolled back)
 * AND on a reversal with no payment journal to undo, which is a genuine no-op on
 * the ledger.
 *
 * Only the code, the posting role and the direction cross to the client. The
 * `detail` string a thrown journal carries is a raw server error message — it
 * stays in the `AdminNotification` and the server log, where the operator's toast
 * cannot leak it. A toast maps the code to its own remedy sentence anyway.
 *
 * `direction` rides along because two codes mean opposite things on the two
 * halves of the toggle — a failed payment wrote nothing and is retried by
 * unmarking, a failed reversal left the earlier payment journal standing and is
 * retried from its own control — and the toast picks the wording from it. Sent
 * from here rather than inferred by the caller from the button it pressed, so the
 * sentence describes the post that actually ran.
 */
export type SetPOPaidAtRefusal =
  | "STANDING_PAYMENT_JOURNAL"
  | "BILLED_VIA_VENDOR_BILL"
  | ReceiptBlockedMarkCode
  | "TANGGAL_TIDAK_SAH"
  | "ADA_PEMBAYARAN_DOKUMEN";

export type SetPOPaidAtResult = {
  changed: boolean;
  refusal: SetPOPaidAtRefusal | null;
  journalFailure: { code: string; role: string | null; direction: SupplierPaymentDirection } | null;
};

/**
 * Thrown inside `setPOPaidAt`'s transaction to roll the mark back when the
 * payment post refuses on a receipt-state code, and caught just outside it.
 * `runSerializable` rethrows a non-retryable error unchanged, so the code arrives
 * intact.
 */
class ReceiptBlockedMarkError extends Error {
  readonly code: ReceiptBlockedMarkCode;

  constructor(code: ReceiptBlockedMarkCode) {
    super(`Supplier payment mark aborted: ${code}`);
    this.code = code;
  }
}

/** Mark a PO as paid (or unmark by passing paidAt: null). */
export async function setPOPaidAt(poId: string, paidAt: Date | null): Promise<SetPOPaidAtResult> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { docNumber: true, status: true },
  });
  if (!po) throw new Error('PO not found');

  /**
   * Fails closed before the transaction opens, matching this file's own
   * `throw new Error('Unauthorized')` convention for a missing session. A
   * missing actor used to be treated as a silent journal skip INSIDE the
   * transaction: the CAS still committed, the outcome reported `changed: true,
   * failure: null`, and the post-commit block was gated on the same actor, so
   * the status history, the payment notification AND any journal-failure
   * notification were all skipped. The PO ended up marked paid with nothing
   * posted to the GL and nothing flagged anywhere. A write that needs an actor
   * to be auditable and journalable must not commit without one.
   */
  const actorId = session.user?.id;
  if (!actorId) throw new Error('Unauthorized');

  if (paidAt != null && !tanggalBayarSah(paidAt)) {
    return { changed: false, refusal: 'TANGGAL_TIDAK_SAH', journalFailure: null };
  }

  const direction: SupplierPaymentDirection = paidAt != null ? 'payment' : 'reversal';
  // Batas tanda "Jurnal gagal" yang boleh diselesaikan toggle ini (lihat sesudah commit).
  const mulaiToggle = new Date();

  /**
   * The toggle and its journal in ONE serializable transaction, so a concurrent
   * toggle can neither interleave between them nor read a half-applied state.
   *
   * The compare-and-swap alone (which is what this used to be) only ordered the
   * two `paidAt` writes. It still left this open: a mark CAS-succeeds and starts
   * posting; an unmark CAS-succeeds because the PO now reads paid, runs its
   * reversal, finds no payment journal yet and returns NOTHING_TO_POST — silent
   * by design in that direction — and then the mark's journal commits. The PO
   * ends up unpaid with DR payables / CR bank standing, and nothing flagged.
   * Serializing the pair removes the window the second toggle needed.
   *
   * Zero rows changed means the PO is already in the requested state, so the
   * status history, the notification and the journal are all skipped.
   *
   * The journal is best-effort for every INFRASTRUCTURE failure:
   * `attemptSupplierPaymentJournal` catches a journal problem INSIDE the callback
   * and hands it back as a value, so the CAS still commits and the failure
   * becomes a JOURNAL_PENDING notification written after the transaction — a
   * misconfiguration on the payment post itself (`UNMAPPED_ROLE`, `UNBALANCED`,
   * a thrown post) must not block ops. Verified on MariaDB: a caught statement
   * error does not poison the surrounding transaction. A deadlock or
   * serialization abort, which MariaDB has already rolled back, rethrows instead
   * so `runSerializable` retries the toggle and the post together.
   *
   * The exception is a MARK refused on one of the three receipt-state codes
   * (`isReceiptBlockedMarkCode`): a receipt awaiting the owner's decision, one
   * still owed with no GRN journal, or a declined one never reversed. Those say
   * the PO is not payable yet, so the callback throws `ReceiptBlockedMarkError`,
   * the transaction rolls the CAS back, and the action returns the code as its
   * `refusal` — no `paidAt`, no status history, no notification. The unmark
   * direction never aborts.
   *
   * A committed failed PAYMENT is rendered by the PO detail page as a banner with
   * its own retry (`retrySupplierPaymentJournalAction`), and unmark-then-mark
   * still re-runs it; a failed REVERSAL is the one case the toggle cannot
   * re-reach, and it has its own control
   * (`postSupplierPaymentReversalJournalAction`).
   */
  type PaidToggleOutcome = {
    changed: boolean;
    refusal: SetPOPaidAtRefusal | null;
    failure: SupplierPaymentPostFailure | null;
  };
  let outcome: PaidToggleOutcome;
  try {
    outcome = await runSerializable<PaidToggleOutcome>(async (tx) => {
      /**
       * A MARK is refused outright while this PO reads unpaid with its payment
       * journal still standing — the state a failed reversal leaves behind. The
       * post used to be the only thing that refused it (`PAYMENT_SUPERSEDED`,
       * once the payable had moved), and by then the CAS had already committed
       * `paidAt`. That is self-defeating: the standing-payment detector requires
       * `paidAt == null`, so committing the mark makes it go false and drops the
       * amber banner off the PO detail page — the only surface carrying the
       * "Post reversal journal" control that actually clears the state. The
       * operator ends up with a paid PO, a stale-amount payment journal, and
       * nothing persistent to recover from. Both UIs already withhold the mark
       * for this reason; every `"use server"` export is an independently callable
       * endpoint, so a stale tab, the register before a refresh or a direct call
       * still reaches this one.
       *
       * INSIDE the callback and BEFORE the compare-and-swap, for the same reason
       * the toggle and its journal are serialized together in the first place: a
       * check outside the write is only a prelude, and a concurrently-posted
       * reversal — which is exactly what clears this state — could commit between
       * the two and turn the answer stale before the CAS ran. Read under this
       * transaction it cannot: the detector's own reads join this transaction's
       * read set, so a serialization conflict aborts and `runSerializable` retries
       * the check, the toggle and the post together rather than any one of them
       * alone. This only widens the atom the surrounding comment argues for; it
       * does not weaken it.
       *
       * MARK ONLY. Unmark stays available on both screens: it is not the
       * dangerous direction, and it is the one that legitimately reaches the
       * reversal writer. The detector is also false for a PO that already reads
       * paid, so a redundant mark still falls through to the CAS and is reported
       * as the no-op it is.
       */
      if (paidAt != null && (await hasStandingPaymentJournalWhileUnpaid(poId, tx))) {
        return { changed: false, refusal: 'STANDING_PAYMENT_JOURNAL', failure: null };
      }

      /**
       * A PO billed through Vendor Billing is paid from the bill, whose vendor payment debits AP
       * itself; marking it paid here too would debit AP twice for the same receipt. Read in this
       * transaction so a bill saved concurrently aborts one of the two. Mark only: unmark stays
       * available.
       */
      if (
        paidAt != null &&
        (await tx.vendorBillLine.count({ where: { poItem: { poId }, bill: { status: { not: 'VOID' } } } })) > 0
      ) {
        return { changed: false, refusal: 'BILLED_VIA_VENDOR_BILL', failure: null };
      }

      /*
       * Pembayaran pemasok sebagian (dokumen BYR/…): kedua arah ditolak bila PO
       * ini sudah punya alokasi pembayaran dokumen — lihat `ADA_PEMBAYARAN_DOKUMEN`.
       * Di dalam transaksi yang sama, sebelum CAS, karena alasan yang sama dengan
       * penjaga di atas: pembayaran dokumen yang di-commit di antara keduanya
       * akan basi bila diperiksa di luar.
       */
      if (await adaPembayaranDokumenUntukPo(poId, tx)) {
        return { changed: false, refusal: 'ADA_PEMBAYARAN_DOKUMEN', failure: null };
      }

      const toggled = await tx.purchaseOrder.updateMany({
        where: { id: poId, paidAt: paidAt != null ? null : { not: null } },
        data: { paidAt },
      });
      if (toggled.count === 0) return { changed: false, refusal: null, failure: null };

      const failure = await attemptSupplierPaymentJournal(direction, () =>
        paidAt != null
          ? postSupplierPaymentJournal(poId, actorId, paidAt, tx)
          : postSupplierPaymentReversalJournal(poId, actorId, tx)
      );
      if (direction === "payment" && failure && isReceiptBlockedMarkCode(failure.reason)) {
        throw new ReceiptBlockedMarkError(failure.reason);
      }
      return { changed: true, refusal: null, failure };
    });
  } catch (e) {
    if (!(e instanceof ReceiptBlockedMarkError)) throw e;
    outcome = { changed: false, refusal: e.code, failure: null };
  }

  if (outcome.changed) {
    /**
     * FIRST of the post-commit writes, ahead of the status history, because a
     * bookkeeping write must never be able to erase the only recovery signal for
     * a ledger inconsistency. The toggle has already committed and the journal
     * has already failed; if the history insert went first and threw — a
     * transient DB error, an FK, anything — nothing would be flagged anywhere.
     * The PO would read paid with no payment journal, no `JOURNAL_PENDING` row,
     * and a re-mark would be a CAS no-op because `paidAt` is already set — that
     * no-op is now reported as one instead of as a payment, but it still posts
     * nothing, so nothing but this row would tell them to unmark first.
     *
     * The history insert below is now guarded too, so on its own that guard would
     * also keep this reachable in either order. The ordering stays as the outer
     * belt: the durable flag must not depend on a `catch` further down the
     * function staying correct, and it costs nothing to keep.
     *
     * The notify helper swallows and logs its own failures, so putting it first
     * cannot block the history insert either — neither write can starve the other.
     *
     * Written outside the transaction on purpose: a notification must not be
     * rolled back by, or contribute its own write to, transaction contention.
     */
    if (outcome.failure) {
      await notifySupplierPaymentJournalFailure(direction, poId, outcome.failure);
    } else {
      /*
       * Tidak ada yang tertunda lagi untuk PO ini, jadi tanda "Jurnal gagal"-nya
       * diselesaikan (Beranda). Tandai bayar berhasil = jurnal pembayaran
       * berdiri. Batal bayar berhasil = PO belum dibayar tanpa jurnal
       * pembayaran tertinggal (dibalik, atau memang tidak pernah ada), jadi tanda
       * "PO ditandai bayar tapi jurnal belum ada" juga tidak berlaku lagi. Hanya
       * tanda yang ditulis sebelum toggle ini: toggle berikutnya yang gagal
       * menulis tandanya sendiri dan tidak boleh ikut terhapus.
       */
      const selesai: SumberNotifikasiJurnal[] = [{ tipe: 'pembayaranPemasok', arah: 'payment', poId }];
      if (direction === 'reversal') selesai.push({ tipe: 'pembayaranPemasok', arah: 'reversal', poId });
      await tandaiJurnalTertundaSelesai(selesai, { dibuatSebelum: mulaiToggle });
    }

    /**
     * Guarded, not just ordered after the notification. Ordering alone protects
     * the DURABLE record; this protects the IMMEDIATE one. An unguarded throw
     * here rejects `setPOPaidAt` before it can return `journalFailure`, so the
     * client falls into its generic error toast and the operator who clicked
     * never sees the warning that explains the ledger gap or the unmark/re-mark
     * remedy — a bookkeeping audit insert would have replaced the only in-UI
     * explanation of a finance inconsistency. The two lessons are separate: the
     * ordering keeps the notification from being skipped, the guard keeps the
     * caller's answer from being replaced.
     *
     * Logged rather than swallowed: a missing payment-event history row is a real
     * audit gap and must stay discoverable in the server log, it just must not
     * change what the operator is told about the journal.
     */
    try {
      await prisma.pOStatusHistory.create({
        data: {
          poId,
          status: po.status,
          changedById: actorId,
          paymentEvent: paidAt != null ? 'MARKED' : 'UNMARKED',
          notes: paidAt != null ? 'Supplier payment marked' : 'Supplier payment unmarked',
        },
      });
    } catch (e) {
      console.error(
        `[setPOPaidAt] FAILED TO WRITE PAYMENT HISTORY for PO ${poId} — the paid toggle committed ` +
          `(${paidAt != null ? 'MARKED' : 'UNMARKED'}) but its POStatusHistory row did not, so the payment event ` +
          'is missing from the audit trail.',
        e,
      );
    }
    getActorName(actorId)
      .then((triggeredByName) =>
        notifyPOPaymentToggled(poId, po.docNumber, paidAt != null, triggeredByName)
      )
      .catch(() => {});

    /*
     * Cermin tombol ini di daftar Pembayaran pemasok (satu pembayaran penuh
     * BYR/…, atau pembatalannya). Sesudah commit dan tidak pernah melempar: angka
     * hutang dibaca dari jurnal tombol ini, jadi cermin yang gagal dibuat hanya
     * berarti barisnya belum tampil di daftar pembayaran.
     */
    await selaraskanCerminTandaiLunas(poId, actorId);
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${poId}`);
  revalidatePath('/backoffice/supplier-payments');

  /**
   * Returned, not thrown: an infrastructure journal problem must still not fail
   * the toggle, which has already committed and is the operator's own retry
   * handle. The `AdminNotification` written above stays either way — the toast is
   * immediate feedback for whoever clicked, the notification is the durable record
   * for whoever audits later. A refusal is returned the same way, with nothing
   * committed and nothing recorded behind it.
   */
  return {
    changed: outcome.changed,
    refusal: outcome.refusal,
    journalFailure: outcome.failure
      ? { code: outcome.failure.reason, role: outcome.failure.role, direction }
      : null,
  };
}

/**
 * `ERROR` is this action's own catch-all, not a code any writer returns. The
 * reversal writer only converts `postJournal`'s UNBALANCED into a value and lets
 * everything else out, and at least one of those throws is ordinary rather than
 * exotic: `postJournal` raises `NON_POSTABLE_ACCOUNT` when a line's chart account
 * has since been deactivated or given a child, which is exactly what happens when
 * someone reorganises the CoA under an account a payment already posted against.
 * Letting that escape would reject the action, so the client falls into its
 * generic catch and — in production, where Next masks a server error to a digest
 * — the operator is told nothing at all about a ledger inconsistency they are
 * standing in front of. Named here instead, so the toast can say which control to
 * use next; the raw message stays in the server log where it cannot leak.
 */
export type PostSupplierPaymentReversalActionResult =
  | GenerateAutoJournalResult
  | { ok: false; code: 'FORBIDDEN' | 'BAD_STATE' | 'ERROR' };

/**
 * Posts the reversal a failed unmark never posted, for a PO that reads unpaid
 * while its payment journal still stands.
 *
 * A DELIBERATE exception to this flow's "no retry button because the toggle IS
 * the retry" rule, not an inconsistency with it. That rule holds wherever the
 * toggle can reach the missing post again; it cannot reach this one. From unpaid
 * the UI only offers "Mark paid", and marking either returns
 * `PAYMENT_SUPERSEDED` (once the payable has moved) or an idempotent hit on the
 * journal already standing — so the mark/unmark dance can be blocked outright,
 * and even when it is not it never posts the reversal that is actually missing.
 * Without this action the operator has no way out through the UI at all.
 *
 * The state check is server-side and re-read here, mirroring the van journal
 * retries (`postVanSaleJournalAction` and siblings): the warning banner's
 * visibility on the PO detail page is not a guard, because every export of a
 * `"use server"` module is an independently callable endpoint reachable by
 * anyone holding `journals:manage`. Do not remove it as "redundant" with the UI
 * condition. Unlike the van retries the evidence is the LEDGER STATE, not a
 * `JOURNAL_PENDING` notification — a state a mark/unmark can reach without any
 * notification ever being written, and one that stops being true the moment the
 * reversal posts, which makes it both stricter and self-clearing.
 *
 * The check and the post run in ONE serializable transaction, for the same reason
 * the paid toggle wraps its own pair: a check outside the write is only a prelude,
 * and a concurrent `setPOPaidAt(paidAt)` can commit between the two. That window
 * was real and it inverted the very bug this control repairs — the mark
 * CAS-succeeds, treats the standing journal as an idempotent same-amount hit and
 * reports a clean payment, then this action posts the reversal anyway, leaving the
 * PO reading PAID with payables owed again and bank restored. Serializing the pair
 * removes the window; `postSupplierPaymentReversalJournal`'s own `PO_IS_PAID`
 * guard closes it a second time from inside, so the invariant does not rest on a
 * non-atomic prelude in either layer. That guard is unreachable from here once the
 * pair is serialized, which is why it is folded into `BAD_STATE` rather than given
 * a code of its own on the wire: both mean "the state this control requires no
 * longer holds", and the operator's next step — reload and look again — is the
 * same.
 *
 * `postSupplierPaymentReversalJournal` handles idempotency (keyed
 * `(SUPPLIER_PAYMENT_REVERSAL, poId#gen)`), so a double-click cannot double-post.
 * Returns a typed result instead of throwing, so the caller can name the failure
 * the same way the toggle's own outcome is named — including for a thrown post,
 * see `ERROR` on the result type.
 */
export async function postSupplierPaymentReversalJournalAction(
  poId: string
): Promise<PostSupplierPaymentReversalActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  const postedById = session.user.id;
  const mulai = new Date();

  let result: PostSupplierPaymentReversalActionResult;
  try {
    result = await runSerializable<PostSupplierPaymentReversalActionResult>(async (tx) => {
      if (!(await hasStandingPaymentJournalWhileUnpaid(poId, tx))) {
        return { ok: false, code: 'BAD_STATE' };
      }
      const posted = await postSupplierPaymentReversalJournal(poId, postedById, tx);
      if (!posted.ok && posted.code === 'PO_IS_PAID') return { ok: false, code: 'BAD_STATE' };
      return posted;
    });
  } catch (e) {
    /* Logged, not swallowed: the reversal is still missing after this, and the
       standing-payment warning stays up because the state check will still be
       true, so the operator keeps a visible way back in — but the reason the
       post failed only exists here. */
    console.error(
      `[postSupplierPaymentReversalJournalAction] FAILED TO POST the missing supplier payment reversal for PO ${poId} — ` +
        'the PO still reads unpaid with its payment journal standing.',
      e,
    );
    result = { ok: false, code: 'ERROR' };
  }

  // Pembalikan berdiri → PO belum dibayar tanpa jurnal tertinggal: tanda "Jurnal gagal"-nya selesai.
  if (result.ok) {
    await selaraskanCerminTandaiLunas(poId, postedById);
    await tandaiJurnalTertundaSelesai(
      [
        { tipe: 'pembayaranPemasok', arah: 'reversal', poId },
        { tipe: 'pembayaranPemasok', arah: 'payment', poId },
      ],
      { dibuatSebelum: mulai },
    );
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${poId}`);
  revalidatePath('/backoffice/supplier-payments');

  return result;
}

export type RetrySupplierPaymentJournalResult =
  | { ok: true }
  | { ok: false; code: "FORBIDDEN" | "BAD_STATE" | "ADA_PEMBAYARAN_DOKUMEN" }
  | { ok: false; code: "JOURNAL_FAILED"; failure: { code: string; role: string | null } };

/**
 * Posts the payment journal a mark never posted, for a PO that reads paid with
 * no payment journal at its current generation and a recorded failed attempt
 * (the same gate as the banner's `paymentJournalPendingWhilePaid`).
 *
 * The second deliberate exception to "the toggle IS the retry", alongside
 * `postSupplierPaymentReversalJournalAction`. The toggle can re-run this post, but
 * only through an unmark and a re-mark, which rewrites `paidAt` to the moment of
 * the re-mark; this posts in place, dated the PO's RECORDED `paidAt` rather than
 * now, so the payment lands in the period the money actually left.
 *
 * The state check is server-side. It is not redundant with the banner: every
 * `"use server"` export is an independently callable endpoint, and the gate is
 * the recorded failure, never "paid without a journal". That keeps out a PO paid
 * before this retry existed and one whose failure notification never wrote, and
 * nothing else: an advance payment, or a PO whose receipts are each sub-cent or
 * owner-declined, recorded `NOTHING_TO_POST` when it was marked, so it passes the
 * gate, and the post here returns `NOTHING_TO_POST` again. It can never post a
 * payment journal for such a PO.
 *
 * The recorded failure is read BEFORE the transaction (`latestPaymentJournalFailure`
 * says why; the rows are append-only). `paidAt` and the current-generation
 * journal are re-read inside it, and check and post run in ONE serializable
 * transaction for the same reason the reversal control does: a concurrent unmark
 * committing between the two would otherwise leave a payment journal standing
 * for a PO that reads unpaid.
 *
 * A failure is written as a `JOURNAL_PENDING` row after the transaction commits.
 * The notifier dedups by `(poId, kind, reason)`, so a repeat of the same failure
 * writes nothing and a new reason writes one row, which the banner then shows.
 * Only the code and role cross to the client; the raw `detail` stays server-side.
 *
 * `ADA_PEMBAYARAN_DOKUMEN` is the one writer refusal that is NOT written as a
 * failure: the PO's receipts were paid through supplier payment documents (which
 * also mark the PO paid once they clear it), so this journal would pay them a
 * second time and must never post. Nothing is pending, the banner no longer shows
 * for such a PO (`paymentJournalPendingWhilePaid`), and the result says why.
 */
export async function retrySupplierPaymentJournalAction(poId: string): Promise<RetrySupplierPaymentJournalResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const actorId = session.user.id;

  type Outcome =
    | { kind: "BAD_STATE" }
    | { kind: "PAID_VIA_DOCUMENTS" }
    | { kind: "POSTED" }
    | { kind: "FAILED"; failure: SupplierPaymentPostFailure };

  if ((await latestPaymentJournalFailure(poId)) == null) return { ok: false, code: "BAD_STATE" };

  let outcome: Outcome;
  try {
    outcome = await runSerializable<Outcome>(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { paidAt: true } });
      const paidAt = po?.paidAt ?? null;
      if (paidAt == null) return { kind: "BAD_STATE" };
      if (await hasCurrentPaymentJournal(poId, tx)) return { kind: "BAD_STATE" };

      const failure = await attemptSupplierPaymentJournal("payment", () =>
        postSupplierPaymentJournal(poId, actorId, paidAt, tx)
      );
      if (failure?.reason === "ADA_PEMBAYARAN_DOKUMEN") return { kind: "PAID_VIA_DOCUMENTS" };
      return failure ? { kind: "FAILED", failure } : { kind: "POSTED" };
    });
  } catch (e) {
    console.error(
      `[retrySupplierPaymentJournalAction] FAILED TO POST the missing supplier payment journal for PO ${poId} — ` +
        "the PO still reads paid with no payment journal.",
      e
    );
    outcome = { kind: "FAILED", failure: { reason: "ERROR", role: null } };
  }

  if (outcome.kind === "FAILED") {
    await notifySupplierPaymentJournalFailure("payment", poId, outcome.failure);
  }

  revalidatePath("/backoffice/purchase-orders");
  revalidatePath(`/backoffice/purchase-orders/${poId}`);
  revalidatePath("/backoffice/supplier-payments");

  if (outcome.kind === "POSTED") return { ok: true };
  if (outcome.kind === "BAD_STATE") return { ok: false, code: "BAD_STATE" };
  if (outcome.kind === "PAID_VIA_DOCUMENTS") return { ok: false, code: "ADA_PEMBAYARAN_DOKUMEN" };
  return {
    ok: false,
    code: "JOURNAL_FAILED",
    failure: { code: outcome.failure.reason, role: outcome.failure.role },
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  recordFieldSalesDelivery,
  closeFieldSalesOrderRemainder,
  type NomorPiutangDipakaiError,
} from "@/lib/field-sales/delivery/writer";
import { DeliveryError } from "@/lib/field-sales/errors";
import { IndenBelumRilisError } from "@/lib/field-sales/inden";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { kabarkanKirimanBerangkat } from "@/lib/spg/pesanan-menuju-toko";
import { logPrint } from "./audit";

export type DeliveryActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "INVALID_REQUEST"
        | "INVALID_DATES"
        | "CONFLICT"
        | "NO_LINES"
        | "OVER_DELIVER"
        | "INSUFFICIENT_STOCK"
        /** Pesanan pre-order yang jendelanya belum dirilis: stoknya belum dicadangkan. */
        | "INDEN_BELUM_RILIS"
        /**
         * Nomor nota sudah dipegang piutang lain (impor/faktur manual), jadi nota tidak bisa
         * menjadi piutang dan pengirimannya dibatalkan. `invoiceNo` menyebut nomornya.
         */
        | "NOMOR_PIUTANG_DIPAKAI"
        /**
         * Sisa pesanan cukup tetapi cadangan stoknya sudah habis dikonsumsi atau tidak ada
         * (pesanan yang disetujui image lama di jendela deploy). Bukan "melebihi sisa".
         */
        | "RESERVATION_MISMATCH";
      shortLines?: Array<{ orderLineId: string; requested: number; onHand: number }>;
      invoiceNo?: string;
    };

/**
 * Dikenali dari namanya, bukan `instanceof`: tiruan modul penulis di spesifikasi aksi tidak
 * membawa kelas galatnya, dan mengakses ekspor yang tidak ada di tiruan itu melempar.
 */
function nomorPiutangDipakai(e: unknown): e is NomorPiutangDipakaiError {
  return e instanceof Error && e.name === "NomorPiutangDipakaiError";
}

/** `CadanganTidakCocokError` dari penulis — dikenali dari namanya, sama dengan di atas. */
function cadanganTidakCocok(e: unknown): boolean {
  return e instanceof Error && e.name === "CadanganTidakCocokError";
}

/**
 * Bentuk baris kiriman: `orderLineId` teks tak kosong, `qty` bilangan bulat positif. Aksi server
 * adalah titik jaringan — isian yang rusak dijawab INVALID_REQUEST, bukan "melebihi sisa".
 */
function barisKirimanSah(lines: unknown): lines is Array<{ orderLineId: string; qty: number }> {
  return (
    Array.isArray(lines) &&
    lines.every(
      (l) =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as { orderLineId?: unknown }).orderLineId === "string" &&
        (l as { orderLineId: string }).orderLineId !== "" &&
        Number.isInteger((l as { qty?: unknown }).qty) &&
        (l as { qty: number }).qty > 0,
    )
  );
}

/**
 * A `YYYY-MM-DD` calendar day at WIB midnight, or null for anything that is not one.
 *
 * Three separate rejections, all of which a crafted payload can reach because a server action is
 * a network endpoint:
 *
 * - a non-string (a JSON number survives `?? ""` and makes `parseDateOnly` throw inside `.trim()`);
 * - a value `new Date` silently rolls over — `"2026-02-30"` parses to 2 March and would be STORED;
 * - a year outside MariaDB's `DATETIME` range, which raises 1292 in strict mode.
 *
 * The round-trip is what closes the last two: `formatDateOnlyJakarta` emits exactly the shape the
 * input carries, so an instant that does not format back to the string it came from was not that
 * calendar day. `parseDateOnly` itself is left alone — it has many other callers and widening its
 * contract is not this feature's business.
 *
 * WIB-anchored rather than a bare `new Date`: production runs UTC, where a plain `YYYY-MM-DD` is
 * read as UTC midnight and lands on the previous WIB calendar day.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

/**
 * Kabar ke salesman pemilik pesanan bahwa sebagian/seluruh pesanannya sudah dikirim.
 *
 * Dipanggil SESUDAH transaksi pengiriman selesai dan tidak pernah melempar: pengiriman sudah
 * tercatat, dan kabar yang gagal tidak boleh membuatnya tampak gagal. Kiriman ulang dengan kunci
 * idempoten yang sama (respons pertama hilang di jalan) tidak dikabarkan dua kali — pemanggil
 * yang tahu itu ulangan tidak memanggil ini sama sekali.
 */
async function kabarPesananDikirim(deliveryId: string, pelakuId: string): Promise<void> {
  try {
    const kiriman = await prisma.fieldSalesDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        docNo: true,
        total: true,
        order: {
          select: { id: true, orderNo: true, salesmanId: true, deliveryStatus: true, store: { select: { name: true } } },
        },
      },
    });
    if (!kiriman || kiriman.order.salesmanId === pelakuId) return;
    const { order } = kiriman;
    const lengkap = order.deliveryStatus === "DELIVERED";
    await kabariPengguna(order.salesmanId, {
      jenis: JENIS_KABAR.PESANAN_DIKIRIM,
      judul: lengkap ? `Pesanan ${order.orderNo} sudah dikirim` : `Pesanan ${order.orderNo} dikirim sebagian`,
      isi: `${order.store.name} · nota ${kiriman.docNo} · ${formatIDR(kiriman.total.toString())}`,
      data: { orderId: order.id, deliveryId },
    });
  } catch (err) {
    console.error("[kabar] pesanan dikirim gagal", deliveryId, err);
  }
}

/** Kabar bahwa sisa pesanan ditutup (tidak akan dikirim), dengan alasannya. Tidak pernah melempar. */
async function kabarPesananDitutup(orderId: string, alasan: string, pelakuId: string): Promise<void> {
  try {
    const order = await prisma.fieldSalesOrder.findUnique({
      where: { id: orderId },
      select: { orderNo: true, salesmanId: true, store: { select: { name: true } } },
    });
    if (!order || order.salesmanId === pelakuId) return;
    await kabariPengguna(order.salesmanId, {
      jenis: JENIS_KABAR.PESANAN_DITUTUP,
      judul: `Sisa pesanan ${order.orderNo} ditutup`,
      isi: `${order.store.name} · sisa barang tidak dikirim. Alasan: ${alasan}`,
      data: { orderId },
    });
  } catch (err) {
    console.error("[kabar] pesanan ditutup gagal", orderId, err);
  }
}

/**
 * Apakah kunci idempoten ini sudah pernah menghasilkan pengiriman. Dibaca SEBELUM penulis berjalan:
 * sesudahnya, kiriman baru dan kiriman ulang tampak sama persis. Kalau pembacaan ini sendiri gagal,
 * anggap bukan ulangan — kabar ganda lebih ringan daripada kabar yang hilang.
 */
async function sudahTercatat(idempotencyKey: string): Promise<boolean> {
  try {
    const ada = await prisma.fieldSalesDelivery.findUnique({ where: { idempotencyKey }, select: { id: true } });
    return ada !== null;
  } catch {
    return false;
  }
}

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_DELIVER)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

/**
 * `idempotencyKey` is required, not optional: it is the only thing between a double-submit and a
 * second stock movement plus a second SalesHistory row, and a repeat only fails on its own if it
 * exceeds the outstanding qty — a partial delivery would go through twice. Taking an object rather
 * than positional args is what lets it be required after the optional `note`.
 */
export async function recordDeliveryAction(input: {
  orderId: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  note?: string;
  invoiceDate: string;
  dueDate: string;
  idempotencyKey: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const { orderId, lines, note, invoiceDate, dueDate, idempotencyKey } = input;
  /* Refuse a malformed key rather than dropping it — passing undefined through restores the unprotected path. */
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "" || idempotencyKey.length > 64) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (typeof orderId !== "string" || orderId === "" || !barisKirimanSah(lines)) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  const parsedInvoiceDate = parseCalendarDay(invoiceDate);
  const parsedDueDate = parseCalendarDay(dueDate);
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }
  const ulangan = await sudahTercatat(idempotencyKey);
  let deliveryId: string;
  try {
    ({ deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: g.userId,
      lines,
      note,
      invoiceDate: parsedInvoiceDate,
      dueDate: parsedDueDate,
      idempotencyKey,
    }));
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, reason: e.code, shortLines: e.shortLines };
    if (e instanceof IndenBelumRilisError) return { ok: false, reason: "INDEN_BELUM_RILIS" };
    if (nomorPiutangDipakai(e)) return { ok: false, reason: "NOMOR_PIUTANG_DIPAKAI", invoiceNo: e.invoiceNo };
    if (cadanganTidakCocok(e)) return { ok: false, reason: "RESERVATION_MISMATCH" };
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  if (!ulangan) void kabarPesananDikirim(deliveryId, g.userId);
  // Barang berangkat ke toko → SPG toko itu dikabari. Sekali per nota: penandanya ada di
  // `kabarkanKirimanBerangkat`, jadi kiriman ulang (juga yang lolos `sudahTercatat`) tidak menggandakan.
  void kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: deliveryId, pelakuId: g.userId });
  return { ok: true };
}

/**
 * Corrects an issued nota's dates. Both move together: they are one document's dating, and
 * letting one shift while the other is frozen reproduces the inverted pair the create path
 * rejects. `docNo` is never touched — the client's immutability rule is about numbers.
 *
 * The audit row is written with `tx.auditLog.create` inside the transaction rather than
 * through `logAudit`, which swallows its own errors by design. A controls trail that can
 * fail silently is worse than none, because its presence is taken as proof.
 *
 * Serializable + compare-and-swap for the same reason. A snapshot read followed by an
 * unconditional update lets two corrections of one nota interleave: both read the same `before`,
 * the second overwrites the first, and BOTH audit rows claim to have started from the original
 * pair — so the trail shows a correction that never happened and loses one that did. The
 * isolation level is what makes the re-read on retry honest; the CAS is what turns a lost update
 * into an explicit `CONFLICT` for the operator who lost the race.
 */
export async function updateDeliveryDatesAction(input: {
  deliveryId: string;
  invoiceDate: string;
  dueDate: string;
  reason: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;

  /**
   * Every dereference sits behind its own typeof. An omitted `reason` used to throw on `.trim()`
   * before the guard that would have rejected it, and a thrown server action is digest-masked in
   * production, so the operator saw a generic failure instead of the real reason.
   */
  if (typeof input.deliveryId !== "string" || input.deliveryId === "" || typeof input.reason !== "string") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  const reason = input.reason.trim();
  if (reason === "") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }

  const parsedInvoiceDate = parseCalendarDay(input.invoiceDate);
  const parsedDueDate = parseCalendarDay(input.dueDate);
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }

  const outcome = await runSerializable<
    { kind: "OK"; orderId: string } | { kind: "NOT_FOUND" } | { kind: "CONFLICT" }
  >(async (tx) => {
    const before = await tx.fieldSalesDelivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, orderId: true, invoiceDate: true, dueDate: true },
    });
    if (!before) return { kind: "NOT_FOUND" };

    /**
     * The read pair is part of the filter, so the write only lands on the row the audit entry is
     * about to describe. A miss means someone else moved it in between; the transaction returns
     * without writing anything, so a `CONFLICT` never leaves an audit row behind. The mariadb
     * driver reports MATCHED rows rather than changed ones (`foundRows` defaults on), so
     * re-submitting the same dates still counts as a hit.
     */
    const swapped = await tx.fieldSalesDelivery.updateMany({
      where: { id: before.id, invoiceDate: before.invoiceDate, dueDate: before.dueDate },
      data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
    });
    if (swapped.count === 0) return { kind: "CONFLICT" };

    /*
     * Nota = piutang: tanggal faktur dan jatuh tempo piutangnya ikut dibetulkan di transaksi yang
     * sama, kalau tidak umur piutang dan "lewat tempo" terus memakai tanggal yang sudah dikoreksi.
     * Nilai dan sisanya tidak disentuh. Nota lama yang belum punya piutang dibiarkan — itu urusan
     * skrip backfill, bukan koreksi tanggal. Id piutangnya dicatat di jejak yang sama.
     */
    const piutang = await tx.receivable.findUnique({ where: { deliveryId: before.id }, select: { id: true } });
    if (piutang) {
      await tx.receivable.update({
        where: { id: piutang.id },
        data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: g.userId,
        action: "UPDATE_DELIVERY_DATES",
        entityType: "FieldSalesDelivery",
        entityId: before.id,
        changes: {
          before: {
            invoiceDate: before.invoiceDate.toISOString(),
            dueDate: before.dueDate.toISOString(),
          },
          after: {
            invoiceDate: parsedInvoiceDate.toISOString(),
            dueDate: parsedDueDate.toISOString(),
          },
        },
        metadata: { receivableId: piutang?.id ?? null },
        reason,
      },
    });

    return { kind: "OK", orderId: before.orderId };
  });

  if (outcome.kind === "NOT_FOUND") return { ok: false, reason: "NOT_FOUND" };
  if (outcome.kind === "CONFLICT") return { ok: false, reason: "CONFLICT" };

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${outcome.orderId}`);
  return { ok: true };
}

export async function closeRemainderAction(orderId: string, reason: string): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  // Alasan wajib; isian yang bukan teks atau kosong adalah permintaan rusak, bukan keadaan pesanan.
  if (typeof orderId !== "string" || orderId === "" || typeof reason !== "string" || reason.trim() === "") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  try {
    await closeFieldSalesOrderRemainder({ orderId, closedById: g.userId, reason: reason.trim() });
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, reason: e.code };
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  void kabarPesananDitutup(orderId, reason.trim(), g.userId);
  return { ok: true };
}

/**
 * Stamps the first print of a nota tagihan and pings finance that a faktur pajak is now due.
 *
 * Compare-and-swap, not read-then-write: a double-click on the print button would otherwise pass
 * a read-then-check twice before either write lands, notifying finance twice for the same
 * document. `updateMany`'s `count` says whether THIS call was the one that flipped
 * `notaPrintedAt` from null — 1 means it genuinely won the first print, 0 means somebody already
 * had (a reprint), which must audit but never notify again.
 *
 * Gated on `FIELD_SALES_ORDERS_VIEW` — the same permission that renders the deliveries card —
 * not a `tax_invoices:*` permission. Requiring faktur authority to print a nota would invert the
 * role separation this feature exists to create.
 *
 * The whole body is one try/catch returning void: the nota is already printed by the time this
 * runs, so a ping failure (or any other failure here) must never surface as a print failure.
 *
 * `logPrint` is wrapped in its OWN try/catch, separate from the outer one: it is the least
 * important write here, but it runs before the CAS, so an unguarded throw from it would abort
 * the whole function and leave `notaPrintedAt` null — vetoing both the stamp and the finance
 * notification because the audit trail hiccuped. Left in its current position (before the CAS)
 * on purpose, so a reprint still gets its own audit row; moving it after the early return would
 * silently stop reprints being audited at all.
 */
export async function recordNotaTagihanPrinted(deliveryId: string): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user?.id) return;
    if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) return;

    try {
      await logPrint("FieldSalesNotaTagihan", deliveryId);
    } catch (err) {
      console.error("[nota-tagihan-print] failed to write the print audit row", err);
    }

    const swapped = await prisma.taxInvoice.updateMany({
      where: { deliveryId, notaPrintedAt: null },
      data: { notaPrintedAt: new Date(), notaPrintedById: session.user.id },
    });
    if (swapped.count !== 1) return;

    const delivery = await prisma.fieldSalesDelivery.findUnique({
      where: { id: deliveryId },
      select: { docNo: true, order: { select: { store: { select: { name: true } } } } },
    });
    if (!delivery) return;

    const storeName = delivery.order.store.name;
    const notification = await prisma.adminNotification.create({
      data: {
        category: "TAX_INVOICE_PENDING",
        severity: "INFO",
        title: `Nota ${delivery.docNo} sudah di-print`,
        message: `Nota ${delivery.docNo} untuk toko ${storeName} sudah di-print. Pastikan buat faktur pajak.`,
        metadata: { deliveryId, docNo: delivery.docNo, storeName },
      },
    });

    void fanOutAdminNotification(notification);
  } catch (err) {
    /* Best-effort: the nota is already printed by the time this runs, so a ping must never fail a print. */
    console.error("[nota-tagihan-print] failed to record print", err);
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { lockPeriodForPosting, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  recordFieldSalesDelivery,
  closeFieldSalesOrderRemainder,
  type NomorPiutangDipakaiError,
} from "@/lib/field-sales/delivery/writer";
import { DeliveryError } from "@/lib/field-sales/errors";
import { serializeReplay, type SerializedReplay } from "@/lib/field-sales/replay-detail";
import { IndenBelumRilisError } from "@/lib/field-sales/inden";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { kabarkanKirimanBerangkat } from "@/lib/spg/pesanan-menuju-toko";
import { SEMUA_SUMBER_JURNAL_NOTA } from "@/lib/finance/lapangan/aturan";
import { kaitNotaTerbit } from "@/lib/finance/lapangan/kait";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";
import { isFieldDeliveryJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { logPrint } from "./audit";

const AUDIT_REASON_MAX_LENGTH = 191;

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
        | "NOT_RETRYABLE"
        | "RECEIVABLE_HAS_PAYMENTS"
        /** Koreksi tanggal nota yang jurnalnya (atau tanggal barunya) jatuh di bulan yang sudah ditutup. */
        | "PERIOD_CLOSED"
        | "SHIPMENT_IN_FLIGHT"
        | "REPLAY_MISMATCH"
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
      shortLines?: Array<{ orderLineId: string; requested: number; onHand: number; available: number }>;
      replay?: SerializedReplay;
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
    if (e instanceof DeliveryError) {
      if (e.code === "REPLAY_MISMATCH" && e.replay) {
        /**
         * The refused replay's delivery is REAL — its stock moved and its receivable stands — and
         * its nota journal may never have posted: a crash after the writer committed and before the
         * post below leaves exactly that, and the operator's edited resubmit lands here. The
         * dialog then rotates its key, so no later call would ever reach the success path for this
         * delivery. So the recorded delivery's nota journal posts here, through the same hook as
         * the success path, before the refusal goes back. The daily sweep would also find it, but
         * only the next night.
         */
        await kaitNotaTerbit(e.replay.deliveryId, g.userId);
      }
      return {
        ok: false,
        reason: e.code,
        shortLines: e.shortLines,
        replay: e.replay ? serializeReplay(e.replay) : undefined,
      };
    }
    if (e instanceof IndenBelumRilisError) return { ok: false, reason: "INDEN_BELUM_RILIS" };
    if (nomorPiutangDipakai(e)) return { ok: false, reason: "NOMOR_PIUTANG_DIPAKAI", invoiceNo: e.invoiceNo };
    if (cadanganTidakCocok(e)) return { ok: false, reason: "RESERVATION_MISMATCH" };
    throw e;
  }

  /**
   * The delivery's ONE journal — the nota journal (`FIELD_DELIVERY`: store receivable, revenue
   * net of PPN, PPN and COGS) — posted AFTER the writer's transaction commits, not inside it.
   * Every value it needs is fixed by rows that transaction just created, so posting inside would
   * only stretch an already long serializable window — it holds the delivery, the stock consume,
   * the order-line updates and the SalesHistory rows — for no correctness gain. Idempotent, and it
   * never fails the delivery: a failure becomes a `nota_putus` JOURNAL_PENDING.
   */
  await kaitNotaTerbit(deliveryId, g.userId);
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
  /* The audit row is the only record of this reason and `AuditLog.reason` is VARCHAR(191), so refuse rather than truncate. */
  if (reason === "" || Array.from(reason).length > AUDIT_REASON_MAX_LENGTH) {
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
    | { kind: "OK"; orderId: string }
    | { kind: "NOT_FOUND" }
    | { kind: "CONFLICT" }
    | { kind: "HAS_PAYMENTS" }
    | { kind: "PERIOD_CLOSED" }
  >(async (tx) => {
    const before = await tx.fieldSalesDelivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, orderId: true, invoiceDate: true, dueDate: true },
    });
    if (!before) return { kind: "NOT_FOUND" };

    /**
     * REFUSE once live money has been applied: a payment receipt (`paidAmount`) or a verified BKM
     * against this nota. Either posts its own DR Cash/Bank / CR receivable journal dated on when the
     * money moved, and that date is correct — no invoice correction changes when it moved. Re-dating
     * the nota journal on a paid invoice therefore SPLITS the pair: invoice Jan 1, payment journaled
     * Jan 5, correct the invoice to Feb 1, and revenue lands in February while the receipt stays in
     * January — January carries a credit receivable balance and revenue is recognised a month after
     * the cash that settled it. A BKM still waiting for verification has moved nothing (a claim is
     * not a payment), so it does not block.
     *
     * Fail closed, not with a warning: the resulting GL disagreement is silent, permanent, and
     * nothing recomputes a journal's date later. An operator who must re-date a paid invoice voids
     * the payment (or cancels the BKM) first — a deliberate, audited act — which reopens the
     * correction.
     *
     * Read and refused BEFORE the delivery CAS below, not after. `runSerializable` is a plain
     * `prisma.$transaction`, which COMMITS on a normal return and rolls back only on a throw — so a
     * refusal placed after the CAS would commit the very swap it reports as refused, moving the
     * delivery's dates while the receivable and both journals kept the old ones. That is the exact
     * three-way split this guard exists to prevent, and it would be permanent: the same call is
     * refused thereafter, so nothing ever reconverges them.
     */
    const receivable = await tx.receivable.findUnique({
      where: { deliveryId: before.id },
      select: { id: true, paidAmount: true },
    });
    if (receivable && Number(receivable.paidAmount) > 0) return { kind: "HAS_PAYMENTS" };
    if (receivable) {
      const verifiedClaim = await tx.paymentClaimReceivable.findFirst({
        where: { receivableId: receivable.id, paymentClaim: { status: "TERVERIFIKASI" } },
        select: { paymentClaimId: true },
      });
      if (verifiedClaim) return { kind: "HAS_PAYMENTS" };
    }

    /**
     * A journal is never moved into or out of a CLOSED month: that month's figures are already
     * reported. The posted date, the date it was shifted away from (`originalDate`) and the new
     * invoice date must all lie in open months. `lockPeriodForPosting` also locks those months'
     * period rows until this transaction ends — earliest month first, the order every poster and
     * the month close take them in — so a month closing concurrently waits for the re-date or sees
     * it. A nota with no journal yet moves nothing in the GL and is not checked: its post dates on
     * the corrected invoice date and follows the closed-period rule then.
     */
    const journals = await tx.journal.findMany({
      where: { sourceType: { in: [...SEMUA_SUMBER_JURNAL_NOTA] }, sourceId: before.id },
      select: { date: true, originalDate: true },
    });
    if (journals.length > 0) {
      const touched = [parsedInvoiceDate, ...journals.flatMap((j) => (j.originalDate ? [j.date, j.originalDate] : [j.date]))].sort(
        (a, b) => a.getTime() - b.getTime(),
      );
      for (const date of touched) {
        if ((await lockPeriodForPosting(tx, date)) === "CLOSED") return { kind: "PERIOD_CLOSED" };
      }
    }

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

    /**
     * The receivable denormalises these dates so the aging list and the overdue sweep read one
     * table. `updateMany`, not `update`: a delivery predating the AR ledger has no receivable, and
     * that must not fail a date correction.
     */
    const receivableSync = await tx.receivable.updateMany({
      where: { deliveryId: before.id },
      data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
    });

    /**
     * An invoice-date correction means the sale belongs to a different period, so its journal moves
     * with it — otherwise the GL and the AR ledger disagree about which month the revenue is in.
     * That is the nota journal (`FIELD_DELIVERY`), or for a delivery journaled before it existed,
     * both halves of the old pair. Every month involved was checked open above. A journal that was
     * shifted out of a closed month now carries its true date, so its `originalDate` is cleared.
     * The action's existing AuditLog entry is what makes the change traceable.
     */
    const journalRedate = await tx.journal.updateMany({
      where: {
        sourceType: { in: [...SEMUA_SUMBER_JURNAL_NOTA] },
        sourceId: before.id,
      },
      data: { date: parsedInvoiceDate, originalDate: null },
    });

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
          /**
           * `Journal` has no history table and no audit of its own, so this row is the ONLY trail
           * for a mutation of posted GL. `receivablesSynced`/`journalsRedated` are the `updateMany`
           * counts above; `journalsPreviousDate` is the date the journals carried before this write,
           * read in this same transaction. A journal shifted out of a closed month carried a date
           * other than its delivery's `invoiceDate`, so the delivery's snapshot is only the fallback
           * for a nota with no journal.
           */
          receivablesSynced: receivableSync.count,
          journalsRedated: journalRedate.count,
          journalsPreviousDate: (journals[0]?.date ?? before.invoiceDate).toISOString(),
        },
        metadata: { receivableId: receivable?.id ?? null },
        reason,
      },
    });

    return { kind: "OK", orderId: before.orderId };
  });

  if (outcome.kind === "NOT_FOUND") return { ok: false, reason: "NOT_FOUND" };
  if (outcome.kind === "CONFLICT") return { ok: false, reason: "CONFLICT" };
  if (outcome.kind === "HAS_PAYMENTS") return { ok: false, reason: "RECEIVABLE_HAS_PAYMENTS" };
  if (outcome.kind === "PERIOD_CLOSED") return { ok: false, reason: "PERIOD_CLOSED" };

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${outcome.orderId}`);
  return { ok: true };
}

type FieldDeliveryJournalKind = "field_delivery_revenue" | "field_delivery_cogs";

export type PostFieldDeliveryJournalsResult =
  | { ok: true; posted: FieldDeliveryJournalKind[]; stillPending: FieldDeliveryJournalKind[] }
  | Extract<DeliveryActionResult, { ok: false }>;

/**
 * Retries a delivery's journal from the receivable's detail page, following the shape of
 * `postVanSaleJournalAction` (`apps/web/app/actions/van-sale.ts`). The two kinds survive as the
 * names of what failed; both post through the nota engine (`postFieldDeliveryRevenueJournal` /
 * `postFieldDeliveryCogsJournal`, `lib/finance/ar/delivery-journal.ts`), so a delivery never gets a
 * second journal beside its nota journal — only a delivery journaled in the old two-journal shape
 * gets its missing half.
 *
 * The ENTRY gate — a kind is only attempted when `isFieldDeliveryJournalRetryable` says it was
 * flagged (the revenue kind also by the nota engine's own `nota_putus` flag) — is a flag, never a
 * missing journal: every backfilled receivable has no journal by construction, and posting one of
 * those would book revenue for a delivery nobody ever attempted to post.
 *
 * The post-attempt success determination is NOT the same gate re-checked. The gate matches any
 * `JOURNAL_PENDING` notification for the (kind, docId) pair and deliberately ignores `readAt`, and
 * nothing in production ever deletes one of those rows — so once a kind has failed once, re-checking
 * the gate after a retry reads "still pending" forever, even immediately after a retry that just
 * succeeded. `postArJournalSafely` returns the outcome it already computes, so success is read from
 * THAT instead.
 */
export async function postFieldDeliveryJournalsAction(deliveryId: string): Promise<PostFieldDeliveryJournalsResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof deliveryId !== "string" || deliveryId === "") return { ok: false, reason: "INVALID_REQUEST" };

  const revenue = await isFieldDeliveryJournalRetryable("field_delivery_revenue", deliveryId);
  const cogs = await isFieldDeliveryJournalRetryable("field_delivery_cogs", deliveryId);
  if (!revenue && !cogs) return { ok: false, reason: "NOT_RETRYABLE" };

  const posted: FieldDeliveryJournalKind[] = [];
  const stillPending: FieldDeliveryJournalKind[] = [];

  if (revenue) {
    const outcome = await postArJournalSafely("field_delivery_revenue", deliveryId, () =>
      postFieldDeliveryRevenueJournal(deliveryId, g.userId),
    );
    (outcome.ok ? posted : stillPending).push("field_delivery_revenue");
  }
  if (cogs) {
    const outcome = await postArJournalSafely("field_delivery_cogs", deliveryId, () =>
      postFieldDeliveryCogsJournal(deliveryId, g.userId),
    );
    (outcome.ok ? posted : stillPending).push("field_delivery_cogs");
  }

  /* Same paths `recordDeliveryAction` revalidates after a successful post — the delivery lives on
   * the order's detail page, not a page of its own. */
  const delivery = await prisma.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: { orderId: true },
  });
  if (delivery) {
    revalidatePath("/backoffice/field-sales-orders");
    revalidatePath(`/backoffice/field-sales-orders/${delivery.orderId}`);
  }

  return { ok: true, posted, stillPending };
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
 * The bookkeeping halves of a nota tagihan print that can fail independently: the audit row, the
 * `notaPrintedAt` stamp (the CAS), and the finance notification (delivery lookup plus the
 * `AdminNotification` row). The push fan-out is not a half: it is fire-and-forget and swallows
 * its own errors, and the `AdminNotification` row it announces is the durable record.
 */
export type NotaTagihanPrintHalf = "AUDIT" | "STAMP" | "NOTIFY";

export type NotaTagihanPrintResult = {
  ok: boolean;
  failed: NotaTagihanPrintHalf[];
  /* Set when nothing ran at all: a bad id, no session or permission, or a failure outside the three halves. */
  reason?: "INVALID_REQUEST" | "FORBIDDEN" | "UNEXPECTED";
};

/**
 * Stamps the first print of a nota tagihan and pings finance that a faktur pajak is now due.
 *
 * A missing or empty id returns before anything runs: Prisma drops an `undefined` filter term, so
 * the CAS below would otherwise match every unprinted faktur in the table.
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
 * Never throws: the nota is already printing by the time this runs, so no failure here may
 * surface as a print failure. It returns a `NotaTagihanPrintResult` instead, naming which halves
 * failed, so the caller can warn the operator rather than let the bookkeeping fail silently. A
 * failed audit does not stop the CAS or the notification, and a failed CAS skips the
 * notification (it is only sent by the call that won the stamp).
 *
 * `logPrint` is wrapped in its OWN try/catch, separate from the CAS: it is the least important
 * write here, but it runs before the CAS, so an unguarded throw from it would abort the whole
 * function and leave `notaPrintedAt` null — vetoing both the stamp and the finance notification
 * because the audit trail hiccuped. Left in its current position (before the CAS) on purpose, so
 * a reprint still gets its own audit row; moving it after the early return would silently stop
 * reprints being audited at all.
 */
export async function recordNotaTagihanPrinted(deliveryId: string): Promise<NotaTagihanPrintResult> {
  if (typeof deliveryId !== "string" || deliveryId === "") {
    return { ok: false, failed: [], reason: "INVALID_REQUEST" };
  }
  const failed: NotaTagihanPrintHalf[] = [];
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, failed: [], reason: "FORBIDDEN" };
    if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) {
      return { ok: false, failed: [], reason: "FORBIDDEN" };
    }

    try {
      await logPrint("FieldSalesDeliveryNotaTagihan", deliveryId);
    } catch (err) {
      failed.push("AUDIT");
      console.error("[nota-tagihan-print] failed to write the print audit row", err);
    }

    let swapped: { count: number };
    try {
      swapped = await prisma.taxInvoice.updateMany({
        where: { deliveryId, notaPrintedAt: null },
        data: { notaPrintedAt: new Date(), notaPrintedById: session.user.id },
      });
    } catch (err) {
      failed.push("STAMP");
      console.error("[nota-tagihan-print] failed to stamp notaPrintedAt", err);
      return { ok: false, failed };
    }
    if (swapped.count !== 1) return { ok: failed.length === 0, failed };

    try {
      const delivery = await prisma.fieldSalesDelivery.findUnique({
        where: { id: deliveryId },
        select: { docNo: true, order: { select: { store: { select: { name: true } } } } },
      });
      if (!delivery) {
        failed.push("NOTIFY");
        return { ok: false, failed };
      }

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
      failed.push("NOTIFY");
      console.error("[nota-tagihan-print] failed to notify finance", err);
    }
    return { ok: failed.length === 0, failed };
  } catch (err) {
    console.error("[nota-tagihan-print] failed to record print", err);
    return { ok: false, failed, reason: "UNEXPECTED" };
  }
}

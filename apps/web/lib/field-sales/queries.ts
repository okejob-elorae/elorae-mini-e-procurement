import { prisma, Prisma, resolveReservedInventory } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { matchKey } from "@/lib/items/match-key";
import { variantDetailForSku } from "@/lib/items/variants";
import { listAssortmentGaps } from "@/lib/stores/assortment/queries";
import { outstandingQty } from "./delivery/plan";
import { deliveredGoodsValue, undeliveredResidual } from "./delivery/undelivered-residual";
import type { PlanHistory } from "./smart-request/plan";
import type { TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import { lencanaIndenById, type LencanaInden } from "./inden-queries";

export type FieldSalesOrderStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

/**
 * Saringan status di daftar: `REJECTED` = ditolak KANTOR saja, `CANCELLED` = dibatalkan
 * salesman sendiri (status tersimpan tetap REJECTED, dibedakan `cancelledById`). `AKTIF` =
 * menunggu + disetujui — pesanan yang dihitung kartu Kinerja sales lapangan.
 */
export type FieldSalesOrderStatusFilter = FieldSalesOrderStatus | "CANCELLED" | "AKTIF";

export type FieldSalesOrderType = "PUTUS" | "KONSI";

export type FieldSalesOrderOrigin = "FIELD" | "ADMIN";

export type FieldSalesDeliveryStatus = "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";
/* OPEN = still awaiting delivery: PENDING or PARTIAL. */
export type DeliveryStatusFilter = FieldSalesDeliveryStatus | "OPEN";

export type FieldSalesDeliveryLineSummary = {
  id: string;
  orderLineId: string;
  productName: string;
  variantSku: string;
  qty: number;
  unitPrice: number | null;
  discountAmount: number;
  lineTotal: number | null;
};

export type FieldSalesDeliverySummary = {
  id: string;
  docNo: string;
  deliveredAt: Date;
  invoiceDate: Date;
  dueDate: Date;
  subtotal: number;
  discountAmount: number;
  total: number;
  deliveredByName: string;
  taxInvoiceStatus: TaxInvoiceStatusFilter | null;
  /** Bukti terima digital; null = belum diterima toko. */
  receivedByName: string | null;
  receivedAt: Date | null;
  podPhotoUrl: string | null;
  lines: FieldSalesDeliveryLineSummary[];
  /** Piutang yang lahir dari nota tagihan ini; null = nota 0 rupiah atau nota lama tanpa piutang. */
  receivable: { id: string; invoiceNo: string } | null;
  /** Faktur pajak nota ini (satu per nota); null hanya untuk data rusak. */
  taxInvoice: { status: "PENDING" | "CREATED" | "NOT_REQUIRED"; invoiceNo: string | null } | null;
};

export type FieldSalesOrderListItem = {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
  origin: FieldSalesOrderOrigin;
  storeName: string;
  salesmanName: string;
  status: FieldSalesOrderStatus;
  total: number;
  createdAt: Date;
  creditHoldAtCreate: boolean;
  /** Status pengiriman (bermakna untuk PUTUS yang disetujui). */
  deliveryStatus: FieldSalesDeliveryStatus;
  /** Pesanan jarak jauh (WA/TELEPON/LAINNYA); null/absen = diambil saat kunjungan. */
  remoteChannel?: string | null;
  /**
   * Pre-order (inden): jendelanya, null = pesanan stok siap. Absen = kueri tidak
   * membacanya. `name` null bila jendelanya sudah tidak ada (tanpa foreign key).
   */
  preorder?: (Omit<LencanaInden, "name"> & { name: string | null }) | null;
  /**
   * Dibatalkan salesman sendiri (status tetap REJECTED, `cancelledById` terisi) —
   * bukan ditolak kantor. Absen = kueri tidak membacanya.
   */
  dibatalkan?: boolean;
  /** Pesanan ini menggantikan pesanan lama (salesman mengubah pesanannya). Absen = tidak dibaca. */
  menggantikan?: TautanPesanan | null;
  /** Pesanan ini sudah diganti pesanan baru. Absen = tidak dibaca. */
  digantiDengan?: TautanPesanan | null;
};

/** Nomor + id pesanan lain, untuk tautan "Menggantikan …" / "Diganti dengan …". */
export type TautanPesanan = { id: string; orderNo: string };

export type FieldSalesOrderDetail = FieldSalesOrderListItem & {
  note: string | null;
  /** Diisi saat salesman membatalkan (atau mengganti) pesanannya sendiri. */
  cancelledAt: Date | null;
  cancelledByName: string | null;
  subtotal: number;
  creditHoldAtCreate: boolean;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  markupPercent: number | null;
  paymentTempo: number;
  orderDiscountAmount: number;
  appliedOrderPromoName: string | null;
  deliveries: FieldSalesDeliverySummary[];
  /**
   * The approve-time transfer of a konsi order approved before stock moved at shipment
   * completion (`shipmentId: null`) — per-shipment transfers are not surfaced here. `null` for
   * every konsi order approved since.
   */
  legacyKonsiTransfer: {
    docNo: string;
    createdAt: Date;
    lines: Array<{ productName: string; variantSku: string; variantLabel: string | null; qty: number }>;
  } | null;
  lines: Array<{
    id: string;
    itemId: string;
    productName: string;
    variantSku: string;
    variantLabel: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    available: number;
    onHand: number;
    outstanding: number;
    discountAmount: number;
    appliedPromoName: string | null;
    belowCost: boolean;
    requestedUnitPrice: number | null;
    appealReason: string | null;
    addedById: string | null;
    /** Baris gratis promo bonus (harga 0). */
    isBonus: boolean;
    bonusPromoName: string | null;
  }>;
};

const toNum = (v: Prisma.Decimal | number): number => Number(v);

export function serializeListItem(row: {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
  origin: FieldSalesOrderOrigin;
  status: FieldSalesOrderStatus;
  total: Prisma.Decimal | number;
  createdAt: Date;
  store: { name: string };
  salesman: { name: string | null };
  creditHoldAtCreate: boolean;
  deliveryStatus: FieldSalesDeliveryStatus;
  remoteChannel?: string | null;
  cancelledById?: string | null;
}): FieldSalesOrderListItem {
  return {
    id: row.id,
    orderNo: row.orderNo,
    orderType: row.orderType,
    origin: row.origin,
    storeName: row.store.name,
    salesmanName: row.salesman.name ?? "—",
    status: row.status,
    total: toNum(row.total),
    createdAt: row.createdAt,
    creditHoldAtCreate: row.creditHoldAtCreate,
    deliveryStatus: row.deliveryStatus,
    // Hanya diteruskan bila kuerinya memilih kolom itu (absen ≠ null).
    ...(row.remoteChannel !== undefined ? { remoteChannel: row.remoteChannel } : {}),
    ...(row.cancelledById !== undefined ? { dibatalkan: row.status === "REJECTED" && !!row.cancelledById } : {}),
  };
}

/**
 * Tautan ganti untuk sekumpulan pesanan, dua kueri paling banyak (bukan per
 * baris): pesanan lama yang DIGANTIKAN (lewat `replacesOrderId` baris itu) dan
 * pesanan baru yang MENGGANTI (baris lain yang `replacesOrderId`-nya menunjuk
 * ke sini — hanya dicari untuk pesanan yang dibatalkan, karena pesanan yang
 * diganti selalu dibatalkan di transaksi yang sama).
 */
export async function petaGanti(
  rows: ReadonlyArray<{ id: string; replacesOrderId: string | null; cancelledById: string | null }>,
): Promise<{ menggantikan: Map<string, TautanPesanan>; digantiDengan: Map<string, TautanPesanan> }> {
  const idLama = Array.from(new Set(rows.map((r) => r.replacesOrderId).filter((x): x is string => !!x)));
  const idBatal = rows.filter((r) => !!r.cancelledById).map((r) => r.id);
  const [lama, baru] = await Promise.all([
    idLama.length > 0
      ? prisma.fieldSalesOrder.findMany({ where: { id: { in: idLama } }, select: { id: true, orderNo: true } })
      : Promise.resolve([] as TautanPesanan[]),
    idBatal.length > 0
      ? prisma.fieldSalesOrder.findMany({
          where: { replacesOrderId: { in: idBatal } },
          select: { id: true, orderNo: true, replacesOrderId: true },
        })
      : Promise.resolve([] as Array<TautanPesanan & { replacesOrderId: string | null }>),
  ]);
  const lamaById = new Map(lama.map((o) => [o.id, { id: o.id, orderNo: o.orderNo }]));
  const menggantikan = new Map<string, TautanPesanan>();
  for (const r of rows) {
    const t = r.replacesOrderId ? lamaById.get(r.replacesOrderId) : undefined;
    if (t) menggantikan.set(r.id, t);
  }
  const digantiDengan = new Map<string, TautanPesanan>();
  for (const o of baru) if (o.replacesOrderId) digantiDengan.set(o.replacesOrderId, { id: o.id, orderNo: o.orderNo });
  return { menggantikan, digantiDengan };
}

/** Lencana pre-order satu pesanan, dari peta `lencanaIndenById`. */
function lencanaPesanan(
  preorderWindowId: string | null,
  peta: Map<string, LencanaInden>,
): FieldSalesOrderListItem["preorder"] {
  if (!preorderWindowId) return null;
  return peta.get(preorderWindowId) ?? { id: preorderWindowId, name: null, dirilis: false };
}

export async function listFieldSalesOrders(
  filter: {
    status?: FieldSalesOrderStatusFilter;
    search?: string;
    orderType?: FieldSalesOrderType;
    origin?: FieldSalesOrderOrigin;
    storeId?: string;
    deliveryStatus?: DeliveryStatusFilter;
    /** INDEN = hanya pesanan pre-order; BIASA = hanya pesanan stok siap. */
    inden?: "INDEN" | "BIASA";
    /**
     * Status pengiriman. Hanya pesanan PUTUS yang DISETUJUI yang punya pengiriman — pesanan
     * menunggu dan konsinyasi juga bernilai bawaan PENDING di kolomnya, jadi keduanya disaring keluar.
     */
    kirim?: FieldSalesDeliveryStatus;
    /** Pembuat pesanan (`?salesman=` dari Kinerja sales lapangan). */
    salesmanId?: string;
    /** Batas tanggal dibuat: `createdAt >= dibuatSejak` dan `< dibuatSebelum` (awal hari WIB). */
    dibuatSejak?: Date;
    dibuatSebelum?: Date;
  },
  paging: { page: number; pageSize: number },
): Promise<{ orders: FieldSalesOrderListItem[]; totalCount: number }> {
  const where: Prisma.FieldSalesOrderWhereInput = {};
  const dan: Prisma.FieldSalesOrderWhereInput[] = [];
  if (filter.status === "CANCELLED") dan.push({ status: "REJECTED", cancelledById: { not: null } });
  else if (filter.status === "REJECTED") dan.push({ status: "REJECTED", cancelledById: null });
  else if (filter.status === "AKTIF") dan.push({ status: { in: ["PENDING_APPROVAL", "APPROVED"] } });
  else if (filter.status) dan.push({ status: filter.status });
  if (filter.salesmanId) dan.push({ salesmanId: filter.salesmanId });
  if (filter.dibuatSejak || filter.dibuatSebelum) {
    dan.push({
      createdAt: {
        ...(filter.dibuatSejak ? { gte: filter.dibuatSejak } : {}),
        ...(filter.dibuatSebelum ? { lt: filter.dibuatSebelum } : {}),
      },
    });
  }
  if (filter.kirim) dan.push({ deliveryStatus: filter.kirim, status: "APPROVED", orderType: "PUTUS" });
  if (dan.length > 0) where.AND = dan;
  if (filter.orderType) where.orderType = filter.orderType;
  if (filter.origin) where.origin = filter.origin;
  if (filter.storeId) where.storeId = filter.storeId;
  if (filter.deliveryStatus) {
    /* A delivery state means nothing before approval — a rejected order sits at the column default PENDING. */
    where.status = "APPROVED";
    where.deliveryStatus = filter.deliveryStatus === "OPEN" ? { in: ["PENDING", "PARTIAL"] } : filter.deliveryStatus;
  }
  if (filter.inden === "INDEN") where.preorderWindowId = { not: null };
  else if (filter.inden === "BIASA") where.preorderWindowId = null;
  if (filter.search && filter.search.trim()) {
    const s = filter.search.trim();
    where.OR = [{ orderNo: cariTeks(s) }, { store: { name: cariTeks(s) } }];
  }
  const [rows, totalCount] = await Promise.all([
    prisma.fieldSalesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: {
        id: true, orderNo: true, orderType: true, origin: true, status: true, total: true, createdAt: true, remoteChannel: true,
        creditHoldAtCreate: true, preorderWindowId: true, cancelledById: true, replacesOrderId: true, deliveryStatus: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
      },
    }),
    prisma.fieldSalesOrder.count({ where }),
  ]);
  const [jendela, ganti] = await Promise.all([lencanaIndenById(rows.map((r) => r.preorderWindowId)), petaGanti(rows)]);
  return {
    orders: rows.map((r) => ({
      ...serializeListItem(r),
      preorder: lencanaPesanan(r.preorderWindowId, jendela),
      menggantikan: ganti.menggantikan.get(r.id) ?? null,
      digantiDengan: ganti.digantiDengan.get(r.id) ?? null,
    })),
    totalCount,
  };
}

export async function getFieldSalesOrderById(id: string): Promise<FieldSalesOrderDetail | null> {
  const row = await prisma.fieldSalesOrder.findUnique({
    where: { id },
    select: {
      id: true, orderNo: true, orderType: true, origin: true, status: true, total: true, subtotal: true, note: true,
      creditHoldAtCreate: true,
      approvedAt: true, rejectedAt: true, rejectReason: true, createdAt: true,
      closedAt: true, closeReason: true,
      orderDiscountAmount: true, appliedOrderPromoId: true, deliveryStatus: true, remoteChannel: true,
      preorderWindowId: true, cancelledById: true, cancelledAt: true, replacesOrderId: true,
      store: { select: { name: true, markupPercent: true, paymentTempo: true } },
      salesman: { select: { name: true } },
      lines: {
        select: {
          id: true, itemId: true, productName: true, variantSku: true, qty: true, unitPrice: true, lineTotal: true,
          discountAmount: true, appliedPromoId: true, requestedUnitPrice: true, appealReason: true,
          deliveredQty: true, cancelledQty: true, addedById: true, isBonus: true, bonusPromoId: true,
          item: { select: { variants: true } },
        },
      },
      deliveries: {
        orderBy: { deliveredAt: "asc" },
        select: {
          id: true, docNo: true, deliveredAt: true, invoiceDate: true, dueDate: true,
          subtotal: true, discountAmount: true, total: true,
          receivedByName: true, receivedAt: true, podPhotoUrl: true,
          deliveredBy: { select: { name: true } },
          receivable: { select: { id: true, invoiceNo: true } },
          taxInvoice: { select: { status: true, invoiceNo: true } },
          lines: {
            select: {
              id: true, orderLineId: true, productName: true, variantSku: true, qty: true,
              unitPrice: true, discountAmount: true, lineTotal: true,
            },
          },
        },
      },
      konsiTransfers: {
        where: { shipmentId: null },
        orderBy: { createdAt: "asc" },
        select: {
          docNo: true,
          createdAt: true,
          lines: {
            select: {
              productName: true, variantSku: true, qty: true,
              item: { select: { variants: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  /**
   * Each line reads the one InventoryValue row the reserve, consume and konsi transfer act on,
   * so the form's cap and the konsi panel's short-line count agree with the writer. A variantless
   * item can hold both a null and a "" row; summing them reports stock the writer never touches.
   */
  const reservations = await prisma.stockReservation.findMany({
    where: { fieldSalesLineId: { in: row.lines.map((l) => l.id) } },
    select: { fieldSalesLineId: true, inventoryValueId: true },
  });
  const pinnedByLineId = new Map(reservations.map((r) => [r.fieldSalesLineId, r.inventoryValueId]));
  const resolveKey = (l: { itemId: string; variantSku: string | null; id: string }) => {
    const inventoryValueId = pinnedByLineId.get(l.id) ?? null;
    return { itemId: l.itemId, variantSku: l.variantSku ?? "", inventoryValueId };
  };
  const distinctKeys = new Map<string, ReturnType<typeof resolveKey>>();
  for (const l of row.lines) {
    const key = resolveKey(l);
    distinctKeys.set(`${key.itemId}::${key.variantSku}::${key.inventoryValueId ?? ""}`, key);
  }
  const resolvedRows = new Map(
    await Promise.all(
      Array.from(distinctKeys, async ([k, key]) => [k, await resolveReservedInventory(prisma, key)] as const),
    ),
  );
  const invForLine = (l: { itemId: string; variantSku: string | null; id: string }) => {
    const key = resolveKey(l);
    return resolvedRows.get(`${key.itemId}::${key.variantSku}::${key.inventoryValueId ?? ""}`) ?? null;
  };

  const promoIds = Array.from(
    new Set(
      [row.appliedOrderPromoId, ...row.lines.map((l) => l.appliedPromoId), ...row.lines.map((l) => l.bonusPromoId)].filter(
        (v): v is string => v !== null,
      ),
    ),
  );
  const promos = promoIds.length > 0
    ? await prisma.promo.findMany({ where: { id: { in: promoIds } }, select: { id: true, name: true } })
    : [];
  const promoNameById = new Map(promos.map((p) => [p.id, p.name]));
  const [jendela, ganti, pembatal] = await Promise.all([
    lencanaIndenById([row.preorderWindowId]),
    petaGanti([row]),
    row.cancelledById ? prisma.user.findUnique({ where: { id: row.cancelledById }, select: { name: true, email: true } }) : null,
  ]);

  return {
    ...serializeListItem(row),
    preorder: lencanaPesanan(row.preorderWindowId, jendela),
    menggantikan: ganti.menggantikan.get(row.id) ?? null,
    digantiDengan: ganti.digantiDengan.get(row.id) ?? null,
    cancelledAt: row.cancelledAt,
    cancelledByName: row.cancelledById ? (pembatal?.name ?? pembatal?.email ?? "—") : null,
    note: row.note,
    subtotal: toNum(row.subtotal),
    creditHoldAtCreate: row.creditHoldAtCreate,
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    markupPercent: row.store.markupPercent === null ? null : Number(row.store.markupPercent),
    paymentTempo: row.store.paymentTempo,
    orderDiscountAmount: toNum(row.orderDiscountAmount),
    appliedOrderPromoName: row.appliedOrderPromoId ? promoNameById.get(row.appliedOrderPromoId) ?? null : null,
    /* Only the legacy approve-time transfer is filtered in, so at most one row. */
    legacyKonsiTransfer: row.konsiTransfers[0]
      ? {
          docNo: row.konsiTransfers[0].docNo,
          createdAt: row.konsiTransfers[0].createdAt,
          lines: row.konsiTransfers[0].lines.map((l) => ({
            productName: l.productName,
            variantSku: l.variantSku,
            variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
            qty: toNum(l.qty),
          })),
        }
      : null,
    deliveries: row.deliveries.map((d) => ({
      id: d.id,
      docNo: d.docNo,
      deliveredAt: d.deliveredAt,
      invoiceDate: d.invoiceDate,
      dueDate: d.dueDate,
      subtotal: toNum(d.subtotal),
      discountAmount: toNum(d.discountAmount),
      total: toNum(d.total),
      deliveredByName: d.deliveredBy.name ?? "—",
      taxInvoiceStatus: d.taxInvoice?.status ?? null,
      receivedByName: d.receivedByName,
      receivedAt: d.receivedAt,
      podPhotoUrl: d.podPhotoUrl,
      lines: d.lines.map((dl) => ({
        id: dl.id,
        orderLineId: dl.orderLineId,
        productName: dl.productName,
        variantSku: dl.variantSku,
        qty: dl.qty,
        unitPrice: dl.unitPrice === null ? null : toNum(dl.unitPrice),
        discountAmount: toNum(dl.discountAmount),
        lineTotal: dl.lineTotal === null ? null : toNum(dl.lineTotal),
      })),
      receivable: d.receivable ? { id: d.receivable.id, invoiceNo: d.receivable.invoiceNo } : null,
      taxInvoice: d.taxInvoice ? { status: d.taxInvoice.status, invoiceNo: d.taxInvoice.invoiceNo } : null,
    })),
    lines: row.lines.map((l) => {
      const qty = l.qty;
      const discountAmount = toNum(l.discountAmount);
      const netUnit = qty > 0 ? (toNum(l.lineTotal) - discountAmount) / qty : 0;
      const inv = invForLine(l);
      const avgCost = inv ? Number(inv.avgCost) : 0;
      return {
        id: l.id, itemId: l.itemId, productName: l.productName, variantSku: l.variantSku,
        variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
        qty, unitPrice: toNum(l.unitPrice), lineTotal: toNum(l.lineTotal),
        available: inv ? Number(inv.qtyOnHand) - Number(inv.reservedQty) : 0,
        /* Raw qtyOnHand, not netted: this order's own reservation already sits inside reservedQty, so the delivery form capping on a netted figure would under-deliver. */
        onHand: inv ? Number(inv.qtyOnHand) : 0,
        outstanding: outstandingQty({ qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty }),
        discountAmount,
        appliedPromoName: l.appliedPromoId ? promoNameById.get(l.appliedPromoId) ?? null : null,
        // Barang bonus memang gratis — bukan "di bawah modal" karena promo potongan.
        belowCost: row.orderType === "PUTUS" && !l.isBonus && qty > 0 && netUnit < avgCost,
        requestedUnitPrice: l.requestedUnitPrice === null ? null : toNum(l.requestedUnitPrice),
        appealReason: l.appealReason,
        addedById: l.addedById,
        isBonus: l.isBonus,
        bonusPromoName: l.bonusPromoId ? promoNameById.get(l.bonusPromoId) ?? null : null,
      };
    }),
  };
}

export type StoreOrderSummaryRow = {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
  status: "PENDING_APPROVAL" | "APPROVED";
  total: number;
  createdAtIso: string;
};

/**
 * `total` is the order's EFFECTIVE value, not the raw `FieldSalesOrder.total`, for an APPROVED
 * putus order: what its deliveries billed (their whole-rupiah `total`s) plus the still-open
 * undelivered remainder, so a remainder-closed order counts only what was delivered. The remainder
 * is measured the way credit exposure measures it (exact delivered goods values through
 * `undeliveredResidual`) and is zero once the order is CLOSED. Konsi and not-yet-approved orders
 * keep the order's own total.
 */
export async function getStoreOrderSummary(storeId: string): Promise<StoreOrderSummaryRow[]> {
  const rows = await prisma.fieldSalesOrder.findMany({
    where: { storeId, status: { not: "REJECTED" } },
    /*
     * `createdAt` alone is not a total order. It has millisecond resolution, so
     * two orders taken in the same tick tie and the database is free to return
     * them either way — which means the "5 newest" window itself can differ
     * between two identical calls. `orderNo` breaks the tie deterministically
     * because it is unique and monotonic within its prefix.
     */
    orderBy: [{ createdAt: "desc" }, { orderNo: "desc" }],
    take: 5,
    select: {
      id: true,
      orderNo: true,
      orderType: true,
      status: true,
      total: true,
      deliveryStatus: true,
      createdAt: true,
      deliveries: {
        select: {
          total: true,
          subtotal: true,
          discountAmount: true,
          lines: { select: { discountAmount: true } },
        },
      },
    },
  });
  return rows.map(r => {
    const effective = r.status === "APPROVED" && r.orderType === "PUTUS";
    const delivered = r.deliveries.reduce((sum, d) => sum + Number(d.total), 0);
    const residual = r.deliveryStatus === "CLOSED"
      ? 0
      : undeliveredResidual(
        Number(r.total),
        r.deliveries.map((d) =>
          deliveredGoodsValue({
            subtotal: Number(d.subtotal),
            discountAmount: Number(d.discountAmount),
            lineDiscounts: d.lines.map((l) => Number(l.discountAmount)),
          }),
        ),
      );
    return {
      id: r.id,
      orderNo: r.orderNo,
      orderType: r.orderType as FieldSalesOrderType,
      status: r.status as "PENDING_APPROVAL" | "APPROVED",
      total: effective ? delivered + residual : Number(r.total),
      createdAtIso: r.createdAt.toISOString(),
    };
  });
}

export type StoreSentItemRow = {
  itemId: string;
  articleSku: string;
  articleName: string;
  variantSku: string;
  totalQty: number;
};

/**
 * Counts what actually reached the store, never what was approved: an approved order can sit
 * undelivered, or be partly delivered and have its remainder closed, and neither leaves the
 * warehouse. Putus reads its delivery lines. Konsi has no delivery document — its stock moves
 * through a KonsiTransfer when a delivery shipment completes — so it reads the order lines'
 * `deliveredQty`, which that completion advances. A legacy konsi order the backfill marked
 * delivered carries `deliveredQty = qty`, so it counts in full, as it did before.
 */
export async function getStoreSentItems(storeId: string): Promise<StoreSentItemRow[]> {
  const [deliveredPutus, deliveredKonsi] = await Promise.all([
    prisma.fieldSalesDeliveryLine.groupBy({
      by: ["itemId", "variantSku"],
      where: { delivery: { order: { storeId, orderType: "PUTUS" } } },
      _sum: { qty: true },
    }),
    prisma.fieldSalesOrderLine.groupBy({
      by: ["itemId", "variantSku"],
      where: { deliveredQty: { gt: 0 }, order: { storeId, status: "APPROVED", orderType: "KONSI" } },
      _sum: { deliveredQty: true },
    }),
  ]);

  const sums = [
    ...deliveredPutus.map((g) => ({ itemId: g.itemId, variantSku: g.variantSku, qty: g._sum.qty ?? 0 })),
    ...deliveredKonsi.map((g) => ({ itemId: g.itemId, variantSku: g.variantSku, qty: g._sum.deliveredQty ?? 0 })),
  ];
  const byKey = new Map<string, { itemId: string; variantSku: string; totalQty: number }>();
  for (const g of sums) {
    const key = `${g.itemId}::${g.variantSku}`;
    const existing = byKey.get(key);
    if (existing) existing.totalQty += g.qty;
    else byKey.set(key, { itemId: g.itemId, variantSku: g.variantSku, totalQty: g.qty });
  }
  const grouped = Array.from(byKey.values());
  if (grouped.length === 0) return [];

  const itemIds = Array.from(new Set(grouped.map((g) => g.itemId)));
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true, nameId: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  return grouped
    .map((g) => {
      const item = itemById.get(g.itemId);
      return {
        itemId: g.itemId,
        articleSku: item?.sku ?? "—",
        articleName: item?.nameId ?? "—",
        variantSku: g.variantSku && g.variantSku.trim() !== "" ? g.variantSku : "—",
        totalQty: g.totalQty,
      };
    })
    .sort((a, b) => a.articleSku.localeCompare(b.articleSku) || a.variantSku.localeCompare(b.variantSku));
}

/**
 * One page of `getStoreSentItems`, with the full row count. The figures come from the same
 * aggregation, so a page can never disagree with the unpaged list; only the slice is cut. An
 * out-of-range `page` is clamped to the last one and the page actually served is returned.
 */
export async function getStoreSentItemsPage(
  storeId: string,
  paging: { page: number; pageSize: number },
): Promise<{ rows: StoreSentItemRow[]; total: number; page: number }> {
  const all = await getStoreSentItems(storeId);
  const lastPage = Math.max(1, Math.ceil(all.length / paging.pageSize));
  const page = Math.min(Math.max(1, paging.page), lastPage);
  return { rows: all.slice((page - 1) * paging.pageSize, page * paging.pageSize), total: all.length, page };
}

/**
 * Items this store has had on any non-rejected konsi order line that is not fully cancelled —
 * the "already sent" set behind the never-sent suggestions and the approve writer's ALREADY_SENT
 * check. A line closed with nothing delivered (`cancelledQty >= qty`) never reached the store, so
 * it does not count. PENDING_APPROVAL stays IN on purpose, the order under approval included —
 * that is why the approve writer checks DUPLICATE before ALREADY_SENT, and its DUPLICATE test
 * pins which code fires for an item already on the order.
 *
 * Filtered in JS because Prisma cannot compare two columns in a `where`; `distinct` is dropped
 * with it, since it would pick one row per item arbitrarily and could discard the uncancelled one.
 */
export async function sentItemIds(
  storeId: string,
  tx: { fieldSalesOrderLine: typeof prisma.fieldSalesOrderLine } = prisma,
): Promise<Set<string>> {
  const rows = await tx.fieldSalesOrderLine.findMany({
    where: { order: { storeId, orderType: "KONSI", status: { not: "REJECTED" } } },
    select: { itemId: true, qty: true, cancelledQty: true },
  });
  return new Set(rows.filter((r) => r.cancelledQty < r.qty).map((r) => r.itemId));
}

export async function getSmartRequestHistory(storeId: string, candidateItemIds: string[]): Promise<PlanHistory> {
  // Baris bonus bukan pilihan toko — tidak dihitung sebagai "pernah dipesan".
  const orderedRows = await prisma.fieldSalesOrderLine.findMany({
    where: { isBonus: false, order: { storeId, status: { not: "REJECTED" } } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  const ordered = new Set(orderedRows.map((r) => r.itemId));
  const neverOrdered = new Set(candidateItemIds.filter((id) => !ordered.has(id)));

  const grouped = await prisma.fieldSalesOrderLine.groupBy({
    by: ["itemId"],
    where: { isBonus: false, order: { storeId, status: "APPROVED" } },
    _sum: { qty: true },
  });
  const qtyByItem = new Map<string, number>(grouped.map((g) => [g.itemId, g._sum.qty ?? 0]));
  return { neverOrdered, qtyByItem };
}

export type KonsiSuggestion = {
  itemId: string;
  variantSku: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  available: number;
  priceUnset: boolean;
};

/**
 * Goods never sent to this store, for the admin to add while approving a konsi order or to send
 * in an admin push.
 * "Never sent" is ITEM-level (matches `sentItemIds` and the writer's ALREADY_SENT check): if any
 * variant of an item was ever sent to this store, the whole item is excluded. Each surviving item
 * is then expanded into one row per variant (real InventoryValue row), because availability and
 * the writer's `addedLines` are both per-variant.
 *
 * A row is ALSO dropped when the same (itemId, variantSku) is a current assortment gap for this
 * store — see `listKonsiAssortmentGaps`. Both are genuinely true for an item that was never sent
 * AND is missing from the assortment, but "this store is supposed to carry this and does not" is
 * the strictly stronger, more actionable claim, so the gap heading wins and this list suppresses
 * the row rather than rendering the same SKU twice under two different urgency framings.
 */
export async function listStoreNeverSentSuggestions(storeId: string): Promise<KonsiSuggestion[]> {
  const exclude = await sentItemIds(storeId);

  /**
   * Raw store gaps, not the order-scoped `listKonsiAssortmentGaps` output: an item already
   * excluded above is excluded from THIS list anyway via `exclude`, and availability is filtered
   * identically (and from the same InventoryValue rows) by both lists, so the two sources agree
   * on every row that could actually collide here.
   */
  const gapKeys = new Set((await listAssortmentGaps(storeId)).map((g) => `${g.itemId}::${g.variantSku}`));

  const where: Prisma.ItemWhereInput = { isActive: true, type: "FINISHED_GOOD" };
  /* Prisma's notIn with an empty array is untrustworthy to lean on — skip the filter entirely. */
  if (exclude.size > 0) where.id = { notIn: [...exclude] };

  const items = await prisma.item.findMany({
    where,
    select: {
      id: true,
      sku: true,
      nameId: true,
      sellingPrice: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
    orderBy: { sku: "asc" },
  });

  /*
   * `InventoryValue` is unique on (itemId, variantSku), but MariaDB permits multiple NULLs, so an
   * item can carry both a `null` and an `""` row (e.g. a variant item restocked via ERP GRN/production
   * writes a `null` pooled row the per-variant sale won't see — see docs/ARCHITECTURE-NOTES.md). Both normalize to the
   * same suggestion key. Dedupe by (itemId, normalized variantSku) rather than emitting one row per
   * raw InventoryValue row, so a collision can't render two indistinguishable suggestions.
   */
  const byKey = new Map<string, { item: (typeof items)[number]; variantSku: string; available: number }>();
  for (const item of items) {
    for (const iv of item.inventoryValues) {
      const variantSku = iv.variantSku ?? "";
      /* Availability is derived, never stored: qtyOnHand - reservedQty. */
      const available = aggregateInventoryValues([iv])!.available;
      const key = `${item.id}::${variantSku}`;
      const existing = byKey.get(key);
      if (existing) {
        /*
         * On a collision, keep the MINIMUM available rather than summing. The writer reserves
         * against a single row chosen by `findReservationInventory`'s findFirst, so the minimum is
         * the only figure guaranteed not to exceed what that reservation can actually satisfy.
         * Summing would offer more than the writer can honor and fail the approval; under-offering
         * only hides a little stock. Fail-safe direction wins. (getFieldSalesOrderById reads the
         * writer's own row instead, since it needs the exact figure per order line.)
         */
        existing.available = Math.min(existing.available, available);
      } else {
        byKey.set(key, { item, variantSku, available });
      }
    }
  }

  /*
   * Drop unavailable rows before shipping to the client. An open suggestions panel on a large
   * catalog otherwise mounts one qty stepper per Habis SKU (hundreds of inert controls). The
   * admin cannot stage qty > available anyway, so zero/negative availability is dead weight.
   */
  const rows: KonsiSuggestion[] = Array.from(byKey.values())
    .filter(({ available }) => available > 0)
    .filter(({ item, variantSku }) => !gapKeys.has(`${item.id}::${variantSku}`))
    .map(({ item, variantSku, available }) => ({
      itemId: item.id,
      variantSku,
      sku: item.sku,
      name: item.nameId,
      variantLabel: variantDetailForSku(item.variants, variantSku),
      available,
      priceUnset: item.sellingPrice === null,
    }));
  return rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.variantSku.localeCompare(b.variantSku));
}

/**
 * What the warehouse can still reserve for each variant of ONE item, keyed by `matchKey` of the
 * `variantSku` (`""` for a variantless item; trimmed and lower-cased, so a caller looks a variant up
 * with `matchKey` of ITS spelling and never compares raw strings). The folded key is for lookup
 * only, never written. Same figure the suggestion lists carry — `qtyOnHand − reservedQty` per
 * `InventoryValue` row, the MINIMUM where a `null` and an `""` row collide — but not filtered to
 * positive, so a sold-out variant reads 0 rather than going missing. A key with no row at all is
 * absent, and the caller reads that as "unknown", never as 0.
 */
export async function getItemAvailabilityBySku(itemId: string): Promise<Record<string, number>> {
  const rows = await prisma.inventoryValue.findMany({
    where: { itemId },
    select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true },
  });
  const bySku: Record<string, number> = {};
  for (const iv of rows) {
    const key = matchKey(iv.variantSku);
    const available = aggregateInventoryValues([iv])!.available;
    bySku[key] = Object.prototype.hasOwnProperty.call(bySku, key) ? Math.min(bySku[key], available) : available;
  }
  return bySku;
}

/* Scopes `listStoreNeverSentSuggestions` to one order's own store. */
export async function listKonsiSuggestions(orderId: string): Promise<KonsiSuggestion[]> {
  const order = await prisma.fieldSalesOrder.findUnique({
    where: { id: orderId },
    select: { storeId: true, orderType: true },
  });
  if (!order || order.orderType !== "KONSI") return [];

  return listStoreNeverSentSuggestions(order.storeId);
}

export type KonsiAssortmentGapSuggestion = {
  itemId: string;
  variantSku: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  available: number;
  priceUnset: boolean;
  targetQty: number | null;
  onHandQty: number;
  inTransitQty: number;
};

/**
 * The store's assortment gaps, restyled as stageable rows for the same two screens that show the
 * never-sent list — the konsi approval panel and the admin push page — a deliberately DIFFERENT
 * signal, not a variant of it.
 * `sentItemIds` drops an item the moment it appears on any non-rejected konsi order line that is
 * not fully cancelled, even if the store now holds zero, so "never sent" can never re-flag a
 * depleted item. An assortment gap catches
 * exactly that case, so this reads `listAssortmentGaps` directly and never filters through
 * `sentItemIds`. This function is the authoritative source for a gap row:
 * `listStoreNeverSentSuggestions` is the one that defers to IT, suppressing its own row for any
 * (itemId, variantSku) this function would also claim, so the two lists never render the same SKU
 * twice.
 *
 * `excludeKeys` are VARIANT grain (`itemId::variantSku`), not item grain: `FieldSalesOrderLine`
 * is per-variant, so a gap on a different variant of an item on the exclusion list is still a
 * genuine gap and must still show.
 *
 * Zero/negative main-warehouse availability is dropped for the same reason
 * `listStoreNeverSentSuggestions` drops it: nothing here is stageable from either screen, so a dead
 * qty stepper is wasted screen space, not information the admin needs here — the store detail
 * page's read-only gap card still shows every gap regardless of main-warehouse stock.
 */
export async function listStoreGapSuggestions(
  storeId: string,
  opts?: { excludeKeys?: string[] },
): Promise<KonsiAssortmentGapSuggestion[]> {
  const gaps = await listAssortmentGaps(storeId);
  if (gaps.length === 0) return [];

  const excludeKeys = new Set(opts?.excludeKeys ?? []);
  const remaining = gaps.filter((g) => !excludeKeys.has(`${g.itemId}::${g.variantSku}`));
  if (remaining.length === 0) return [];

  const itemIds = Array.from(new Set(remaining.map((g) => g.itemId)));
  /**
   * Same isActive/type filter `listStoreNeverSentSuggestions` applies — a deactivated or
   * raw-material item dropped from the assortment lines table would otherwise still render here
   * as a stageable gap and abort either caller (the order-scoped approve panel or the admin push)
   * with UNKNOWN_ITEM, since both writers filter on the same two fields.
   */
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, isActive: true, type: "FINISHED_GOOD" },
    select: {
      id: true,
      sellingPrice: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const rows: KonsiAssortmentGapSuggestion[] = [];
  for (const gap of remaining) {
    const item = itemsById.get(gap.itemId);
    if (!item) continue;

    /**
     * Same null/"" collision `listStoreNeverSentSuggestions` guards against: MariaDB permits
     * multiple NULLs on the (itemId, variantSku) unique index, so an item can carry both a `null`
     * and an `""` InventoryValue row for the same logical variant. Keep the MINIMUM available
     * across a collision — same fail-safe direction as the writer's own reservation lookup. Both
     * the order-scoped approve panel and the admin push read this list, so either caller benefits.
     */
    let available: number | null = null;
    for (const iv of item.inventoryValues) {
      if ((iv.variantSku ?? "") !== gap.variantSku) continue;
      const a = aggregateInventoryValues([iv])!.available;
      available = available === null ? a : Math.min(available, a);
    }
    if (available === null || available <= 0) continue;

    rows.push({
      itemId: gap.itemId,
      variantSku: gap.variantSku,
      sku: gap.itemSku,
      name: gap.productName,
      variantLabel: variantDetailForSku(item.variants, gap.variantSku),
      available,
      priceUnset: item.sellingPrice === null,
      targetQty: gap.targetQty,
      onHandQty: gap.onHandQty,
      inTransitQty: gap.inTransitQty,
    });
  }
  return rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.variantSku.localeCompare(b.variantSku));
}

/* Scopes `listStoreGapSuggestions` to one order's own store, excluding that order's own lines. */
export async function listKonsiAssortmentGaps(orderId: string): Promise<KonsiAssortmentGapSuggestion[]> {
  const order = await prisma.fieldSalesOrder.findUnique({
    where: { id: orderId },
    select: { storeId: true, orderType: true, lines: { select: { itemId: true, variantSku: true } } },
  });
  if (!order || order.orderType !== "KONSI") return [];

  return listStoreGapSuggestions(order.storeId, {
    excludeKeys: order.lines.map((l) => `${l.itemId}::${l.variantSku}`),
  });
}

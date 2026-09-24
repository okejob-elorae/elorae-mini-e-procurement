/**
 * Resolves a `Receivable` or `TaxInvoice` row to whichever document actually backs it — a putus
 * `FieldSalesDelivery` or a `KonsiSellThrough` report — now that both relations on both models are
 * optional (`Receivable.deliveryId`/`sellThroughId`, `TaxInvoice.deliveryId`/`sellThroughId`).
 *
 * Deliberately import-free apart from `import type { Prisma }` for the `Decimal` type on
 * `FieldSalesDelivery.total` — no runtime `@elorae/db` import, so this module stays cheap to pull
 * into anything, the same policy as `lib/field-sales/retur/variance.ts` and
 * `lib/tax-invoices/status-display.ts`. The two `SELECT` constants are plain object literals typed
 * with `as const`. They carry no `satisfies Prisma.ReceivableSelect`/`TaxInvoiceSelect` annotation;
 * each consumer's own `select` inference type-checks them.
 *
 * `resolve*` prefers `delivery` when both relations are somehow set, and throws
 * `ReceivableSourceMissingError` when neither is — both branches are unreachable through the normal
 * write paths (exactly one of the two FKs is ever set), except for an orphan whose relation row was
 * deleted out from under it, which `relationMode = "prisma"` makes possible with no database FK to
 * stop it.
 */
import type { Prisma } from "@elorae/db";

export const RECEIVABLE_SOURCE_SELECT = {
  delivery: {
    select: {
      id: true,
      docNo: true,
      deliveredAt: true,
      order: {
        select: {
          id: true,
          orderNo: true,
          salesmanId: true,
          salesman: { select: { name: true } },
        },
      },
    },
  },
  sellThrough: {
    select: {
      id: true,
      docNo: true,
      periodStart: true,
      periodEnd: true,
      salesmanId: true,
      salesman: { select: { name: true } },
    },
  },
} as const;

export type ReceivableSourceRow = {
  delivery: {
    id: string;
    docNo: string;
    deliveredAt: Date;
    order: {
      id: string;
      orderNo: string;
      salesmanId: string;
      salesman: { name: string | null } | null;
    };
  } | null;
  sellThrough: {
    id: string;
    docNo: string;
    periodStart: Date | null;
    periodEnd: Date;
    salesmanId: string | null;
    salesman: { name: string | null } | null;
  } | null;
};

export type ReceivableSource =
  | {
      kind: "DELIVERY";
      deliveryId: string;
      docNo: string;
      orderId: string;
      orderNo: string;
      salesmanId: string;
      salesmanName: string | null;
      deliveredAt: Date;
    }
  | {
      kind: "SELL_THROUGH";
      sellThroughId: string;
      docNo: string;
      salesmanId: string | null;
      salesmanName: string | null;
      periodStart: Date | null;
      periodEnd: Date;
    };

/**
 * Thrown by `resolveReceivableSource`/`resolveTaxInvoiceSource` when a row carries neither
 * relation. Unreachable through any writer in this codebase — every `Receivable`/`TaxInvoice` is
 * created with exactly one of `deliveryId`/`sellThroughId` set — except for an orphan whose
 * relation row was deleted after the fact: `relationMode = "prisma"` means neither FK is backed by
 * a real database constraint, so that deletion is not stopped at the database.
 */
export class ReceivableSourceMissingError extends Error {
  constructor() {
    super("row has neither a delivery nor a sellThrough source");
    this.name = "ReceivableSourceMissingError";
  }
}

export function resolveReceivableSource(row: ReceivableSourceRow): ReceivableSource {
  if (row.delivery) {
    return {
      kind: "DELIVERY",
      deliveryId: row.delivery.id,
      docNo: row.delivery.docNo,
      orderId: row.delivery.order.id,
      orderNo: row.delivery.order.orderNo,
      salesmanId: row.delivery.order.salesmanId,
      salesmanName: row.delivery.order.salesman?.name ?? null,
      deliveredAt: row.delivery.deliveredAt,
    };
  }
  if (row.sellThrough) {
    return {
      kind: "SELL_THROUGH",
      sellThroughId: row.sellThrough.id,
      docNo: row.sellThrough.docNo,
      salesmanId: row.sellThrough.salesmanId,
      salesmanName: row.sellThrough.salesman?.name ?? null,
      periodStart: row.sellThrough.periodStart,
      periodEnd: row.sellThrough.periodEnd,
    };
  }
  throw new ReceivableSourceMissingError();
}

/**
 * The DELIVERY arm is field for field the `delivery` selection `lib/tax-invoices/queries.ts`'s
 * `listTaxInvoices` read before it switched to this constant, so the switch changed no output.
 * The SELL_THROUGH arm adds `id` (needed for `sellThroughId`) and `storeId` alongside the nested
 * `store` relation, mirroring the delivery arm's own `orderId` + `order.store.*` shape.
 */
export const TAX_INVOICE_SOURCE_SELECT = {
  delivery: {
    select: {
      docNo: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      orderId: true,
      order: { select: { store: { select: { id: true, name: true, npwp: true } } } },
    },
  },
  sellThrough: {
    select: {
      id: true,
      docNo: true,
      storeId: true,
      store: { select: { id: true, name: true, npwp: true } },
      periodEnd: true,
    },
  },
} as const;

export type TaxInvoiceSourceRow = {
  delivery: {
    docNo: string;
    invoiceDate: Date;
    dueDate: Date;
    total: Prisma.Decimal | number;
    orderId: string;
    order: { store: { id: string; name: string; npwp: string | null } };
  } | null;
  sellThrough: {
    id: string;
    docNo: string;
    storeId: string;
    store: { id: string; name: string; npwp: string | null };
    periodEnd: Date;
  } | null;
};

export type TaxInvoiceSource =
  | {
      kind: "DELIVERY";
      docNo: string;
      orderId: string;
      storeId: string;
      storeName: string;
      storeNpwp: string | null;
      invoiceDate: Date;
      dueDate: Date;
      total: number;
    }
  | {
      kind: "SELL_THROUGH";
      docNo: string;
      sellThroughId: string;
      storeId: string;
      storeName: string;
      storeNpwp: string | null;
      /**
       * A report carries no invoice date, due date or total until invoicing stamps them; this arm
       * must read them off the report once it does.
       */
      invoiceDate: null;
      dueDate: null;
      total: null;
      periodEnd: Date;
    };

export function resolveTaxInvoiceSource(row: TaxInvoiceSourceRow): TaxInvoiceSource {
  if (row.delivery) {
    return {
      kind: "DELIVERY",
      docNo: row.delivery.docNo,
      orderId: row.delivery.orderId,
      storeId: row.delivery.order.store.id,
      storeName: row.delivery.order.store.name,
      storeNpwp: row.delivery.order.store.npwp,
      invoiceDate: row.delivery.invoiceDate,
      dueDate: row.delivery.dueDate,
      total: Number(row.delivery.total),
    };
  }
  if (row.sellThrough) {
    return {
      kind: "SELL_THROUGH",
      docNo: row.sellThrough.docNo,
      sellThroughId: row.sellThrough.id,
      storeId: row.sellThrough.storeId,
      storeName: row.sellThrough.store.name,
      storeNpwp: row.sellThrough.store.npwp,
      invoiceDate: null,
      dueDate: null,
      total: null,
      periodEnd: row.sellThrough.periodEnd,
    };
  }
  throw new ReceivableSourceMissingError();
}

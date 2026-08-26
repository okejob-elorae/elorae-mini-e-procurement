import type { StatusTone } from '@/components/ui/status-pill';

/**
 * One place that decides how every document state is spoken and coloured.
 *
 * Two problems this exists to end. Raw enum names reached the screen — a PO row
 * showed "Closed" beside an ETA chip reading "Selesai", so the same row spoke
 * two languages about the same fact. And each module invented its own badge
 * colour, so amber meant "partial" on one screen and "needs attention" on the
 * next.
 *
 * `labelKey` points at the `statuses` i18n namespace rather than holding a
 * string, so the label follows the locale like everything else.
 */
export type StatusMeta = { labelKey: string; tone: StatusTone };

const UNKNOWN: StatusMeta = { labelKey: 'unknown', tone: 'inactive' };

/** Purchase orders. */
const PO: Record<string, StatusMeta> = {
  DRAFT: { labelKey: 'poDraft', tone: 'inactive' },
  SUBMITTED: { labelKey: 'poSubmitted', tone: 'waiting' },
  PARTIAL: { labelKey: 'poPartial', tone: 'progress' },
  CLOSED: { labelKey: 'poClosed', tone: 'settled' },
  OVER: { labelKey: 'poOver', tone: 'attention' },
  CANCELLED: { labelKey: 'poCancelled', tone: 'inactive' },
};

/** Marketplace sales orders. */
const SALES_ORDER: Record<string, StatusMeta> = {
  NEW: { labelKey: 'soNew', tone: 'waiting' },
  PROCESSING: { labelKey: 'soProcessing', tone: 'progress' },
  SHIPPED: { labelKey: 'soShipped', tone: 'progress' },
  COMPLETED: { labelKey: 'soCompleted', tone: 'settled' },
  CANCELLED: { labelKey: 'soCancelled', tone: 'inactive' },
  RETURNED: { labelKey: 'soReturned', tone: 'attention' },
};

/** Fulfilment stage within an order. */
const FULFILLMENT: Record<string, StatusMeta> = {
  PENDING: { labelKey: 'fulPending', tone: 'waiting' },
  PICKED: { labelKey: 'fulPicked', tone: 'progress' },
  PACKED: { labelKey: 'fulPacked', tone: 'progress' },
  SHIPPED: { labelKey: 'fulShipped', tone: 'settled' },
};

/** Work orders. */
const WORK_ORDER: Record<string, StatusMeta> = {
  DRAFT: { labelKey: 'woDraft', tone: 'inactive' },
  RELEASED: { labelKey: 'woReleased', tone: 'waiting' },
  IN_PROGRESS: { labelKey: 'woInProgress', tone: 'progress' },
  COMPLETED: { labelKey: 'woCompleted', tone: 'settled' },
  CANCELLED: { labelKey: 'woCancelled', tone: 'inactive' },
};

/** Field sales orders (putus + konsi). */
const FIELD_SALES: Record<string, StatusMeta> = {
  PENDING_APPROVAL: { labelKey: 'fsPendingApproval', tone: 'waiting' },
  APPROVED: { labelKey: 'fsApproved', tone: 'settled' },
  REJECTED: { labelKey: 'fsRejected', tone: 'inactive' },
};

/** Delivery progress of an approved putus order. */
const DELIVERY: Record<string, StatusMeta> = {
  PENDING: { labelKey: 'dlvPending', tone: 'waiting' },
  PARTIAL: { labelKey: 'dlvPartial', tone: 'progress' },
  DELIVERED: { labelKey: 'dlvDelivered', tone: 'settled' },
  CLOSED: { labelKey: 'dlvClosed', tone: 'inactive' },
};

/** Tax invoice against a billing note. */
const TAX_INVOICE: Record<string, StatusMeta> = {
  PENDING: { labelKey: 'taxPending', tone: 'waiting' },
  CREATED: { labelKey: 'taxCreated', tone: 'settled' },
  NOT_REQUIRED: { labelKey: 'taxNotRequired', tone: 'inactive' },
};

export const STATUS_MAPS = {
  purchaseOrder: PO,
  salesOrder: SALES_ORDER,
  fulfillment: FULFILLMENT,
  workOrder: WORK_ORDER,
  fieldSales: FIELD_SALES,
  delivery: DELIVERY,
  taxInvoice: TAX_INVOICE,
} as const;

export type StatusDomain = keyof typeof STATUS_MAPS;

/**
 * Falls back to `inactive` + an "unknown" label rather than throwing: a status
 * this map has not caught up with should render as an unremarkable grey pill,
 * never crash the list it appears in.
 */
export function getStatusMeta(domain: StatusDomain, status: string | null | undefined): StatusMeta {
  if (!status) return UNKNOWN;
  return STATUS_MAPS[domain][status] ?? UNKNOWN;
}

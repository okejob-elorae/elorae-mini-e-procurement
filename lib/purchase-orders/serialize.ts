import { getETAStatus } from '@/lib/eta-alerts';
import type { POStatus } from '@prisma/client';

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function serializePOListLineItem(line: {
  id: string;
  poId: string;
  itemId: string;
  variantSku: string | null;
  qty: unknown;
  price: unknown;
  ppnIncluded: boolean;
  receivedQty: unknown;
  uomId: string;
  notes: string | null;
  createdAt: Date;
  item?: { sku: string; nameId: string } | null;
}) {
  return {
    id: line.id,
    poId: line.poId,
    itemId: line.itemId,
    variantSku: line.variantSku,
    qty: toNum(line.qty) ?? 0,
    price: toNum(line.price) ?? 0,
    ppnIncluded: line.ppnIncluded,
    receivedQty: toNum(line.receivedQty) ?? 0,
    uomId: line.uomId,
    notes: line.notes,
    createdAt: toIso(line.createdAt),
    item: line.item
      ? { sku: line.item.sku, nameId: line.item.nameId }
      : undefined,
  };
}

export function serializePOListRow(po: {
  id: string;
  docNumber: string;
  supplierId: string;
  status: POStatus;
  etaDate: Date | null;
  paymentDueDate: Date | null;
  paidAt: Date | null;
  currency: string;
  totalAmount: unknown;
  taxAmount: unknown;
  grandTotal: unknown;
  notes: string | null;
  terms: string | null;
  createdById: string;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  supplier: { name: string; code: string };
  items: Array<Parameters<typeof serializePOListLineItem>[0]>;
  _count: { grns: number };
}) {
  return {
    id: po.id,
    docNumber: po.docNumber,
    supplierId: po.supplierId,
    status: po.status,
    etaDate: toIso(po.etaDate),
    paymentDueDate: toIso(po.paymentDueDate),
    paidAt: toIso(po.paidAt),
    currency: po.currency,
    totalAmount: toNum(po.totalAmount) ?? 0,
    taxAmount: toNum(po.taxAmount) ?? 0,
    grandTotal: toNum(po.grandTotal) ?? 0,
    notes: po.notes,
    terms: po.terms,
    createdById: po.createdById,
    syncStatus: po.syncStatus,
    createdAt: toIso(po.createdAt),
    updatedAt: toIso(po.updatedAt),
    supplier: po.supplier,
    items: po.items.map(serializePOListLineItem),
    _count: po._count,
    etaAlert: getETAStatus(po.etaDate, po.status),
  };
}

type PODetailRow = {
  id: string;
  docNumber: string;
  supplierId: string;
  status: POStatus;
  etaDate: Date | null;
  paymentDueDate: Date | null;
  paidAt: Date | null;
  currency: string;
  totalAmount: unknown;
  taxAmount: unknown;
  grandTotal: unknown;
  notes: string | null;
  terms: string | null;
  createdById: string;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  supplier: Record<string, unknown>;
  items: Array<{
    id: string;
    poId: string;
    itemId: string;
    variantSku: string | null;
    qty: unknown;
    price: unknown;
    ppnIncluded: boolean;
    receivedQty: unknown;
    uomId: string;
    notes: string | null;
    createdAt: Date;
    item?: {
      id: string;
      sku: string;
      nameId: string;
      nameEn: string | null;
      type: string;
      variants: unknown;
      uom: { id: string; code: string; nameId: string; nameEn: string } | null;
    } | null;
  }>;
  grns: Array<{
    id: string;
    docNumber: string;
    totalAmount: unknown;
    grnDate: Date;
  }>;
  statusHistory: Array<{
    id: string;
    poId: string;
    status: POStatus;
    changedById: string;
    notes: string | null;
    createdAt: Date;
    changedBy: { id: string; name: string | null; email: string | null };
  }>;
};

export function serializePODetail(po: PODetailRow) {
  return {
    id: po.id,
    docNumber: po.docNumber,
    supplierId: po.supplierId,
    status: po.status,
    etaDate: toIso(po.etaDate),
    paymentDueDate: toIso(po.paymentDueDate),
    paidAt: toIso(po.paidAt),
    currency: po.currency,
    totalAmount: toNum(po.totalAmount) ?? 0,
    taxAmount: toNum(po.taxAmount) ?? 0,
    grandTotal: toNum(po.grandTotal) ?? 0,
    notes: po.notes,
    terms: po.terms,
    createdById: po.createdById,
    syncStatus: po.syncStatus,
    createdAt: toIso(po.createdAt),
    updatedAt: toIso(po.updatedAt),
    supplier: po.supplier,
    items: po.items.map((line) => ({
      id: line.id,
      poId: line.poId,
      itemId: line.itemId,
      variantSku: line.variantSku,
      qty: toNum(line.qty) ?? 0,
      price: toNum(line.price) ?? 0,
      ppnIncluded: line.ppnIncluded,
      receivedQty: toNum(line.receivedQty) ?? 0,
      uomId: line.uomId,
      notes: line.notes,
      createdAt: toIso(line.createdAt),
      item: line.item
        ? {
            id: line.item.id,
            sku: line.item.sku,
            nameId: line.item.nameId,
            nameEn: line.item.nameEn,
            type: line.item.type,
            variants: line.item.variants,
            uom: line.item.uom
              ? {
                  id: line.item.uom.id,
                  code: line.item.uom.code,
                  nameId: line.item.uom.nameId,
                  nameEn: line.item.uom.nameEn,
                }
              : null,
          }
        : null,
    })),
    grns: po.grns.map((g) => ({
      id: g.id,
      docNumber: g.docNumber,
      totalAmount: toNum(g.totalAmount) ?? 0,
      grnDate: toIso(g.grnDate),
    })),
    statusHistory: po.statusHistory.map((h) => ({
      id: h.id,
      poId: h.poId,
      status: h.status,
      changedById: h.changedById,
      notes: h.notes,
      createdAt: toIso(h.createdAt),
      changedBy: h.changedBy,
    })),
  };
}

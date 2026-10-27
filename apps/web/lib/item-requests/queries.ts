import { prisma } from "@elorae/db";
import type { RequestStatus } from "./status";

export type RequestLineRow = {
  id: string;
  requestId: string;
  docNumber: string;
  createdAt: Date;
  neededBy: Date | null;
  sourceWo: { id: string; docNumber: string; status: string } | null;
  itemId: string;
  itemSku: string;
  itemName: string;
  variantSku: string;
  qty: number;
  uomCode: string;
  status: RequestStatus;
  po: { id: string; docNumber: string } | null;
};

const lineSelect = {
  id: true,
  requestId: true,
  itemId: true,
  variantSku: true,
  qty: true,
  status: true,
  item: { select: { sku: true, nameId: true } },
  uom: { select: { code: true } },
  po: { select: { id: true, docNumber: true } },
  request: {
    select: {
      docNumber: true,
      createdAt: true,
      neededBy: true,
      sourceWo: { select: { id: true, docNumber: true, status: true } },
    },
  },
} as const;

type LineRecord = {
  id: string;
  requestId: string;
  itemId: string;
  variantSku: string;
  qty: { toString(): string };
  status: RequestStatus;
  item: { sku: string; nameId: string };
  uom: { code: string };
  po: { id: string; docNumber: string } | null;
  request: {
    docNumber: string;
    createdAt: Date;
    neededBy: Date | null;
    sourceWo: { id: string; docNumber: string; status: string } | null;
  };
};

function toRow(l: LineRecord): RequestLineRow {
  return {
    id: l.id,
    requestId: l.requestId,
    docNumber: l.request.docNumber,
    createdAt: l.request.createdAt,
    neededBy: l.request.neededBy,
    sourceWo: l.request.sourceWo,
    itemId: l.itemId,
    itemSku: l.item.sku,
    itemName: l.item.nameId,
    variantSku: l.variantSku,
    qty: Number(l.qty),
    uomCode: l.uom.code,
    status: l.status,
    po: l.po,
  };
}

export async function listRequestLines(filters: { status?: RequestStatus; search?: string }) {
  const search = filters.search?.trim();
  const lines = await prisma.itemRequestLine.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(search
        ? {
            OR: [
              { item: { nameId: { contains: search } } },
              { item: { sku: { contains: search } } },
              { request: { docNumber: { contains: search } } },
              { request: { sourceWo: { docNumber: { contains: search } } } },
            ],
          }
        : {}),
    },
    select: lineSelect,
    // Lines of one request share createdAt; id breaks the tie so rows keep their order between loads.
    orderBy: [{ request: { createdAt: "desc" } }, { requestId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  return lines.map((l) => toRow(l as LineRecord));
}

export async function getRequestDetail(id: string) {
  const request = await prisma.itemRequest.findUnique({
    where: { id },
    select: {
      id: true,
      docNumber: true,
      status: true,
      notes: true,
      neededBy: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      sourceWo: { select: { id: true, docNumber: true, status: true } },
      lines: { select: lineSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!request) return null;
  return { ...request, lines: request.lines.map((l) => toRow(l as LineRecord)) };
}

/** Latest PO price per item from this supplier, to prefill the conversion dialog. */
export async function getLastPurchasePrices(itemIds: string[], supplierId: string): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const rows = await prisma.pOItem.findMany({
    where: { itemId: { in: itemIds }, po: { supplierId, status: { not: "CANCELLED" } } },
    select: { itemId: true, price: true },
    orderBy: { createdAt: "desc" },
  });
  const prices: Record<string, number> = {};
  for (const r of rows) if (!(r.itemId in prices)) prices[r.itemId] = Number(r.price);
  return prices;
}

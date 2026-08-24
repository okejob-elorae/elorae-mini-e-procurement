import { prisma, Prisma } from "@elorae/db";
import { lineVariance } from "./variance";

export type FieldReturnStatus =
  | "PENDING_WAREHOUSE_RECEIVING"
  | "MISMATCH_PENDING_RESOLUTION"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "CANCELLED";
export type FieldReturnReason = "DAMAGED" | "UNSOLD" | "EXPIRED" | "OTHER";
export type FieldReturnTransport = "SELF_CARRY" | "EXPEDITION";

export type FieldReturnRow = {
  id: string;
  docNo: string;
  storeName: string;
  transport: FieldReturnTransport;
  status: FieldReturnStatus;
  lineCount: number;
  createdAt: Date;
};

export async function listFieldReturns(params: {
  q?: string;
  page: number;
  perPage: number;
}): Promise<{ rows: FieldReturnRow[]; total: number }> {
  const q = params.q?.trim();
  const where: Prisma.FieldReturnWhereInput = q
    ? { OR: [{ docNo: { contains: q } }, { store: { name: { contains: q } } }] }
    : {};

  const [rows, total] = await Promise.all([
    prisma.fieldReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        docNo: true,
        status: true,
        transport: true,
        createdAt: true,
        store: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.fieldReturn.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      storeName: r.store.name,
      transport: r.transport,
      status: r.status,
      lineCount: r._count.lines,
      createdAt: r.createdAt,
    })),
    total,
  };
}

export type FieldReturnResolutionDetail = {
  id: string;
  type: string;
  qty: number;
  note: string | null;
  createdAt: Date;
  createdByLabel: string;
};

export type FieldReturnLineDetail = {
  id: string;
  itemSku: string;
  itemName: string;
  variantSku: string;
  qty: number;
  reason: FieldReturnReason;
  reasonNote: string | null;
  receivedQty: number | null;
  sellableQty: number | null;
  rejectedQty: number | null;
  /** `lineVariance(qty, receivedQty)` — 0 until received, then received minus claimed. */
  variance: number;
  /** Ordered `createdAt desc, id desc` — index 0 is the effective (latest) resolution. */
  resolutions: FieldReturnResolutionDetail[];
};

export type FieldReturnDetail = {
  id: string;
  docNo: string;
  status: FieldReturnStatus;
  storeName: string;
  raisedByLabel: string;
  transport: FieldReturnTransport;
  expeditionName: string | null;
  resiNo: string | null;
  notaPhotoUrl: string;
  note: string | null;
  createdAt: Date;
  lines: FieldReturnLineDetail[];
};

export async function getFieldReturnById(id: string): Promise<FieldReturnDetail | null> {
  const r = await prisma.fieldReturn.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      status: true,
      transport: true,
      expeditionName: true,
      resiNo: true,
      notaPhotoUrl: true,
      note: true,
      createdAt: true,
      raisedById: true,
      store: { select: { name: true } },
      lines: {
        select: {
          id: true,
          qty: true,
          variantSku: true,
          reason: true,
          reasonNote: true,
          receivedQty: true,
          sellableQty: true,
          rejectedQty: true,
          item: { select: { sku: true, nameId: true } },
          resolutions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, type: true, qty: true, note: true, createdAt: true, createdById: true },
          },
        },
      },
    },
  });
  if (!r) return null;

  /**
   * `raisedById` on `FieldReturn` and `createdById` on each `FieldReturnResolution` are bare
   * scalars with no relation, so every label is a separate batch lookup rather than an
   * `include`. One query covers the salesman plus every resolution's author.
   */
  const userIds = Array.from(
    new Set([r.raisedById, ...r.lines.flatMap((l) => l.resolutions.map((res) => res.createdById))])
  );
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const labelFor = (userId: string): string => labelById.get(userId) ?? "—";

  return {
    id: r.id,
    docNo: r.docNo,
    status: r.status,
    storeName: r.store.name,
    raisedByLabel: labelFor(r.raisedById),
    transport: r.transport,
    expeditionName: r.expeditionName,
    resiNo: r.resiNo,
    notaPhotoUrl: r.notaPhotoUrl,
    note: r.note,
    createdAt: r.createdAt,
    lines: r.lines.map((l) => ({
      id: l.id,
      itemSku: l.item.sku,
      itemName: l.item.nameId,
      variantSku: l.variantSku,
      qty: l.qty,
      reason: l.reason,
      reasonNote: l.reasonNote,
      receivedQty: l.receivedQty,
      sellableQty: l.sellableQty,
      rejectedQty: l.rejectedQty,
      variance: lineVariance(l.qty, l.receivedQty),
      resolutions: l.resolutions.map((res) => ({
        id: res.id,
        type: res.type,
        qty: res.qty,
        note: res.note,
        createdAt: res.createdAt,
        createdByLabel: labelFor(res.createdById),
      })),
    })),
  };
}

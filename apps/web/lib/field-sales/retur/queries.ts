import { prisma, Prisma } from "@elorae/db";

export type FieldReturnStatus = "PENDING_WAREHOUSE_RECEIVING" | "CANCELLED";
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

export type FieldReturnLineDetail = {
  id: string;
  itemSku: string;
  itemName: string;
  variantSku: string;
  qty: number;
  reason: FieldReturnReason;
  reasonNote: string | null;
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
          item: { select: { sku: true, nameId: true } },
        },
      },
    },
  });
  if (!r) return null;

  /**
   * `raisedById` is a bare scalar with no relation on `FieldReturn`, so the
   * salesman's name is a separate lookup rather than an `include`.
   */
  const raisedBy = await prisma.user.findUnique({
    where: { id: r.raisedById },
    select: { name: true, email: true },
  });

  return {
    id: r.id,
    docNo: r.docNo,
    status: r.status,
    storeName: r.store.name,
    raisedByLabel: raisedBy ? (raisedBy.name ?? raisedBy.email) : "—",
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
    })),
  };
}

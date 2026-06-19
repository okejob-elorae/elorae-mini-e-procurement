import { prisma } from "@elorae/db";
import type { SalesChannel, SalesReturnStatus } from "@/lib/constants/enums";

export async function getSalesReturnById(id: string) {
  return prisma.salesReturn.findUnique({
    where: { id },
    include: {
      salesOrder: { select: { id: true, salesorderNo: true } },
      decidedBy: { select: { name: true, email: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { sku: true, nameId: true, nameEn: true } },
          decidedBy: { select: { name: true } },
        },
      },
    },
  });
}

export type SalesReturnDetail = NonNullable<Awaited<ReturnType<typeof getSalesReturnById>>>;

export type SalesReturnsListFilter = {
  search?: string;
  channel?: SalesChannel;
  status?: SalesReturnStatus;
  receivedFrom?: Date;
  receivedTo?: Date;
};

export type Pagination = { page: number; pageSize: number };

export type SalesReturnsListRow = {
  id: string;
  jubelioReturnId: number;
  jubelioReturnNo: string | null;
  channel: SalesChannel;
  channelOrderNo: string | null;
  status: SalesReturnStatus;
  buyerName: string | null;
  totalQty: number;
  totalValue: string;
  receivedAt: Date;
  decidedAt: Date | null;
};

export type SalesReturnsKpi = {
  totalCount: number;
  pendingCount: number;
  acceptanceRate: number | null;
  totalValue: string;
};

function decimalToString(v: unknown): string {
  if (v === null || v === undefined) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return (v as { toString: () => string }).toString();
}

export async function listSalesReturns(
  filter: SalesReturnsListFilter,
  page: Pagination,
): Promise<{ rows: SalesReturnsListRow[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (filter.channel) where.channel = filter.channel;
  if (filter.status) where.status = filter.status;
  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim();
    where.OR = [
      { jubelioReturnNo: { contains: q } },
      { channelOrderNo: { contains: q } },
      { buyerName: { contains: q } },
    ];
  }
  if (filter.receivedFrom || filter.receivedTo) {
    const range: Record<string, Date> = {};
    if (filter.receivedFrom) range.gte = filter.receivedFrom;
    if (filter.receivedTo) range.lte = filter.receivedTo;
    where.receivedAt = range;
  }

  const [rows, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: page.pageSize,
      skip: (page.page - 1) * page.pageSize,
      select: {
        id: true,
        jubelioReturnId: true,
        jubelioReturnNo: true,
        channel: true,
        channelOrderNo: true,
        status: true,
        buyerName: true,
        totalQty: true,
        totalValue: true,
        receivedAt: true,
        decidedAt: true,
      },
    }),
    prisma.salesReturn.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      jubelioReturnId: r.jubelioReturnId,
      jubelioReturnNo: r.jubelioReturnNo,
      channel: r.channel as SalesChannel,
      channelOrderNo: r.channelOrderNo,
      status: r.status as SalesReturnStatus,
      buyerName: r.buyerName,
      totalQty: r.totalQty,
      totalValue: decimalToString(r.totalValue),
      receivedAt: r.receivedAt,
      decidedAt: r.decidedAt,
    })),
    total,
  };
}

export async function getSalesReturnsKpi(
  period?: { from: Date; to: Date },
): Promise<SalesReturnsKpi> {
  const where: Record<string, unknown> = {};
  if (period) where.receivedAt = { gte: period.from, lte: period.to };

  const [totalCount, pendingCount, acceptedCount, rejectedCount, valueAgg] = await Promise.all([
    prisma.salesReturn.count({ where }),
    prisma.salesReturn.count({ where: { ...where, status: "PENDING" } }),
    prisma.salesReturn.count({ where: { ...where, status: "ACCEPTED" } }),
    prisma.salesReturn.count({ where: { ...where, status: "REJECTED" } }),
    prisma.salesReturn.aggregate({ where, _sum: { totalValue: true } }),
  ]);

  const decidedCount = acceptedCount + rejectedCount;
  const acceptanceRate = decidedCount > 0 ? acceptedCount / decidedCount : null;

  return {
    totalCount,
    pendingCount,
    acceptanceRate,
    totalValue: decimalToString(valueAgg._sum.totalValue),
  };
}

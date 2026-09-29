import { prisma } from "@elorae/db";
import type { SalesReturnStatus, SalesReturnItemDecision } from "@/lib/constants/enums";

export type SalesOrderReturnItemRow = {
  salesOrderDetailId: number | null;
  qty: string;
  decision: SalesReturnItemDecision;
};

export type SalesOrderReturnRow = {
  id: string;
  jubelioReturnNo: string | null;
  jubelioReturnId: number;
  status: SalesReturnStatus;
  receivedAt: Date;
  items: SalesOrderReturnItemRow[];
};

/**
 * Sibling of `getSalesOrderById`, kept separate so callers that never render
 * returns (the pick-list and packing-slip print pages) don't pay for the
 * `salesReturns` + nested items join.
 */
export async function getSalesOrderReturns(salesOrderId: string): Promise<SalesOrderReturnRow[]> {
  const rows = await prisma.salesReturn.findMany({
    where: { salesOrderId },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      jubelioReturnNo: true,
      jubelioReturnId: true,
      status: true,
      receivedAt: true,
      items: {
        select: {
          salesOrderDetailId: true,
          qty: true,
          decision: true,
        },
      },
    },
  });

  return rows.map((ret: any) => ({
    id: ret.id,
    jubelioReturnNo: ret.jubelioReturnNo,
    jubelioReturnId: ret.jubelioReturnId,
    status: ret.status as SalesReturnStatus,
    receivedAt: ret.receivedAt,
    items: ret.items.map((it: any) => ({
      salesOrderDetailId: it.salesOrderDetailId,
      qty: it.qty.toString(),
      decision: it.decision as SalesReturnItemDecision,
    })),
  }));
}

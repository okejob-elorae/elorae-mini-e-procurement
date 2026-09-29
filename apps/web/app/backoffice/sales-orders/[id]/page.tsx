import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { summarizeReturns, type LineReturnSummary } from "@/lib/sales-orders/returns-summary";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { SalesOrderDetailClient } from "./SalesOrderDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SalesOrderDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await getSalesOrderById(id);
  if (!data) notFound();

  const canFulfill = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.SALES_ORDERS_FULFILL,
  );
  const canViewReturns = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.SALES_RETURNS_VIEW,
  );

  const linePairs = data.items
    .filter((it) => it.itemId !== null)
    .map((it) => ({ itemId: it.itemId as string, variantSku: null }));
  const imageMap = await getPrimaryImagesBatch(linePairs);
  const lineImages: Record<string, string> = Object.fromEntries(imageMap);

  const { byLine, unmatchedQty } = summarizeReturns(data.returns);
  const returnLineSummaries: Record<string, LineReturnSummary> = Object.fromEntries(
    Array.from(byLine.entries()).map(([lineId, summary]) => [String(lineId), summary]),
  );
  const returns = data.returns.map((ret) => ({
    id: ret.id,
    jubelioReturnNo: ret.jubelioReturnNo,
    jubelioReturnId: ret.jubelioReturnId,
    status: ret.status,
    receivedAt: ret.receivedAt,
  }));

  return (
    <SalesOrderDetailClient
      order={data.order}
      items={data.items}
      canFulfill={canFulfill}
      lineImages={lineImages}
      returns={returns}
      returnLineSummaries={returnLineSummaries}
      unmatchedReturnQty={unmatchedQty}
      canViewReturns={canViewReturns}
    />
  );
}

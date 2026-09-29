import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { getSalesOrderReturns } from "@/lib/sales-orders/returns-queries";
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
  const [data, orderReturns] = await Promise.all([
    getSalesOrderById(id),
    getSalesOrderReturns(id),
  ]);
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

  const { byLine, unmatchedQty } = summarizeReturns(orderReturns);
  const returnLineSummaries: Record<string, LineReturnSummary> = Object.fromEntries(
    Array.from(byLine.entries()).map(([lineId, summary]) => [String(lineId), summary]),
  );

  return (
    <SalesOrderDetailClient
      order={data.order}
      items={data.items}
      canFulfill={canFulfill}
      lineImages={lineImages}
      returns={orderReturns}
      returnLineSummaries={returnLineSummaries}
      unmatchedReturnQty={unmatchedQty}
      canViewReturns={canViewReturns}
    />
  );
}

import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
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

  const linePairs = data.items
    .filter((it) => it.itemId !== null)
    .map((it) => ({ itemId: it.itemId as string, variantSku: it.variantSku }));
  const imageMap = await getPrimaryImagesBatch(linePairs);
  const lineImages: Record<string, string> = Object.fromEntries(imageMap);

  return (
    <SalesOrderDetailClient
      order={data.order}
      items={data.items}
      canFulfill={canFulfill}
      lineImages={lineImages}
    />
  );
}

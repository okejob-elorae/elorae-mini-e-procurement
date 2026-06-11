import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
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

  return <SalesOrderDetailClient order={data.order} items={data.items} />;
}

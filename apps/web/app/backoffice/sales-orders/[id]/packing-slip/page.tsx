import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { PackingSlipPrint } from "./PackingSlipPrint";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PackingSlipPrintPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await getSalesOrderById(id);
  if (!data) notFound();

  const linePairs = data.items
    .filter((it) => it.itemId !== null)
    .map((it) => ({ itemId: it.itemId as string, variantSku: it.variantSku }));
  const imageMap = await getPrimaryImagesBatch(linePairs);
  const lineImages: Record<string, string> = Object.fromEntries(imageMap);

  return <PackingSlipPrint order={data.order} items={data.items} lineImages={lineImages} />;
}

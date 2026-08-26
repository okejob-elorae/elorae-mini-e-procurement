import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStoreDeliveries } from "@/lib/archive/queries";
import { StoreArchiveClient } from "./StoreArchiveClient";

export const dynamic = "force-dynamic";

export default async function StoreArchivePage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { storeId } = await params;
  const data = await getStoreDeliveries(storeId);
  if (!data.storeName) notFound();

  return <StoreArchiveClient storeId={storeId} {...data} storeName={data.storeName} />;
}

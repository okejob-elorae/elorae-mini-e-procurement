import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStoreDeliveries } from "@/lib/archive/queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { StoreArchiveClient } from "./StoreArchiveClient";

export const dynamic = "force-dynamic";

export default async function StoreArchivePage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Sama dengan arsipnya: pembelian (izin menu samping) atau pembaca piutang.
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW) && !bolehMembacaPiutang(izin)) {
    redirect("/backoffice");
  }

  const { storeId } = await params;
  const data = await getStoreDeliveries(storeId);
  if (!data.storeName) notFound();

  return <StoreArchiveClient storeId={storeId} {...data} storeName={data.storeName} />;
}

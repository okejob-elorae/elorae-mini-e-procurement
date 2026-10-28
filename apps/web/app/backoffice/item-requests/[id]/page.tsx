import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getRequestDetail } from "@/lib/item-requests/queries";
import { ItemRequestDetailClient } from "./ItemRequestDetailClient";

export default async function ItemRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.ITEM_REQUESTS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const request = await getRequestDetail(id);
  if (!request) notFound();

  return <ItemRequestDetailClient request={request} />;
}

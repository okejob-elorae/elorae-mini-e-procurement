import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import { StoreForm } from "../StoreForm";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const canEdit = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  return (
    <StoreForm mode="edit" storeId={store.id} readOnly={!canEdit} initial={{
      code: store.code,
      name: store.name,
      address: store.address,
      phone: store.phone,
      contactName: store.contactName,
      termsType: store.termsType,
      paymentTempo: store.paymentTempo,
      marginPercent: store.marginPercent,
      lat: store.lat,
      lng: store.lng,
      isActive: store.isActive,
    }} />
  );
}

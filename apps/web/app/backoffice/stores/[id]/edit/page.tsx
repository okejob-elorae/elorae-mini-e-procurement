import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import { StoreForm } from "../../StoreForm";
import { Button } from "@/components/ui/button";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) {
    redirect(`/backoffice/stores/${id}`);
  }

  const store = await getStore(id);
  if (!store) notFound();

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/backoffice/stores/${store.id}`}>
            <ArrowLeft className="h-4 w-4" />
            {store.name}
          </Link>
        </Button>
      </div>
      <StoreForm
        mode="edit"
        storeId={store.id}
        initial={{
          code: store.code,
          name: store.name,
          address: store.address,
          phone: store.phone,
          contactName: store.contactName,
          termsType: store.termsType,
          paymentTempo: store.paymentTempo,
          marginPercent: store.marginPercent,
          priceDiscountPercent: store.priceDiscountPercent,
          creditLimit: store.creditLimit,
          lat: store.lat,
          lng: store.lng,
          checkinRadiusMeters: store.checkinRadiusMeters,
          isActive: store.isActive,
        }}
      />
    </div>
  );
}

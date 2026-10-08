import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/stores/queries";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarArea } from "@/lib/stores/areas";
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

  const [store, areas, salesmen] = await Promise.all([getStore(id), daftarArea(), daftarSalesman()]);
  if (!store) notFound();

  // Pemegang yang perannya sudah bukan sales tetap harus tampil sebagai
  // pilihan — kalau tidak, pemilihnya kosong dan menyimpan formulir diam-diam
  // tetap mempertahankan orang yang tidak kelihatan.
  if (store.salesmanId && !salesmen.some((s) => s.id === store.salesmanId)) {
    const u = await prisma.user.findUnique({ where: { id: store.salesmanId }, select: { id: true, name: true, email: true } });
    if (u) salesmen.push({ id: u.id, nama: u.name ?? u.email });
  }

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
        areas={areas}
        salesmen={salesmen}
        initial={{
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
          checkinRadiusMeters: store.checkinRadiusMeters,
          creditLimit: store.creditLimit,
          maxOpenInvoices: store.maxOpenInvoices,
          storeClass: store.storeClass,
          isPkp: store.isPkp,
          consignmentVat: store.consignmentVat,
          groupId: store.groupId,
          salesmanId: store.salesmanId,
          isActive: store.isActive,
        }}
      />
    </div>
  );
}

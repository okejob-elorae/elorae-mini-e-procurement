import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { syaratDijualOffline } from "@/lib/items/saluran-jual";
import { PromoForm } from "../PromoForm";

export const dynamic = "force-dynamic";

export default async function NewPromoPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");

  const [items, stores] = await Promise.all([
    prisma.item.findMany({
      // Promo putus berlaku untuk pesanan offline: barang "Marketplace saja" tidak ditawarkan (P3a).
      where: { isActive: true, type: "FINISHED_GOOD", ...syaratDijualOffline() },
      select: { id: true, sku: true, nameId: true },
      orderBy: { nameId: "asc" },
    }),
    prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManage = hasPermission(perms, PERMISSIONS.PROMOS_MANAGE);

  return (
    <PromoForm
      mode="create"
      canManage={canManage}
      itemOptions={items.map((i) => ({ ...i, isActive: true }))}
      storeOptions={stores.map((s) => ({ ...s, isActive: true }))}
      defaults={null}
    />
  );
}

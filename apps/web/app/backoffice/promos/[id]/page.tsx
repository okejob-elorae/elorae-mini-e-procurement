import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { syaratDijualOffline } from "@/lib/items/saluran-jual";
import { getPromoById } from "@/lib/promos/queries";
import { PromoForm } from "../PromoForm";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditPromoPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const promo = await getPromoById(id);
  if (!promo) notFound();
  // Kolom promo bonus tidak ikut `getPromoById`; dibaca di sini untuk formulir ubah.
  const bonus = await prisma.promo.findUnique({
    where: { id },
    select: { bonusBuyQty: true, bonusFreeQty: true, bonusItemId: true },
  });

  // Union with active options so an already-assigned item/store that's since
  // gone inactive still shows (and doesn't silently drop on save).
  const [items, stores] = await Promise.all([
    prisma.item.findMany({
      where: {
        OR: [
          // Pilihan baru hanya barang yang dijual offline (P3a); yang sudah tersimpan tetap tampil.
          { isActive: true, type: "FINISHED_GOOD", ...syaratDijualOffline() },
          { id: { in: bonus?.bonusItemId ? [...promo.itemIds, bonus.bonusItemId] : promo.itemIds } },
        ],
      },
      select: { id: true, sku: true, nameId: true, isActive: true },
      orderBy: { nameId: "asc" },
    }),
    prisma.store.findMany({
      where: {
        OR: [{ isActive: true }, { id: { in: promo.storeIds } }],
      },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManage = hasPermission(perms, PERMISSIONS.PROMOS_MANAGE);

  return (
    <PromoForm
      mode="edit"
      canManage={canManage}
      itemOptions={items}
      storeOptions={stores}
      defaults={promo}
      defaultsBonus={bonus}
    />
  );
}

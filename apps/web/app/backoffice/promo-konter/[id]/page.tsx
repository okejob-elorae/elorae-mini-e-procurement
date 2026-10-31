import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { opsiFormPromoKonter, promoKonterUntukUbah } from "@/lib/spg/promo-konter-kantor-queries";
import { PromoKonterForm } from "../PromoKonterForm";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** Ubah promo konter; tanpa `promos:manage` formulirnya hanya bisa dibaca. */
export default async function PromoKonterUbahPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const promo = await promoKonterUntukUbah(id);
  if (!promo) notFound();
  // Pilihan yang sudah dipilih tetap tampil walau barang/kategori/tokonya kini nonaktif.
  const opsi = await opsiFormPromoKonter({ itemIds: promo.isian.itemIds, categoryIds: promo.isian.categoryIds, storeIds: promo.isian.storeIds });

  return (
    <PromoKonterForm
      key={promo.id}
      id={promo.id}
      awal={promo.isian}
      isActive={promo.isActive}
      status={promo.status}
      nota={promo.nota}
      opsi={opsi}
      bolehUbah={hasPermission(izin, PERMISSIONS.PROMOS_MANAGE)}
    />
  );
}

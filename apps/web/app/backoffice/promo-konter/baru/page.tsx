import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { opsiFormPromoKonter } from "@/lib/spg/promo-konter-kantor-queries";
import { PromoKonterForm } from "../PromoKonterForm";

export const dynamic = "force-dynamic";

/** Promo konter baru — hanya `promos:manage`; yang hanya boleh melihat dikembalikan ke daftar. */
export default async function PromoKonterBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");
  if (!hasPermission(izin, PERMISSIONS.PROMOS_MANAGE)) redirect("/backoffice/promo-konter");

  const opsi = await opsiFormPromoKonter();
  return <PromoKonterForm id={null} awal={null} opsi={opsi} bolehUbah />;
}

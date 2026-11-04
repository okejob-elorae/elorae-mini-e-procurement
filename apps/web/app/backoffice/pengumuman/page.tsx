import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { KEADAAN_PENGUMUMAN, type KeadaanPengumuman } from "@/lib/pengumuman/aturan";
import { BATAS_DAFTAR_KANTOR, daftarPengumumanKantor } from "@/lib/pengumuman/queries";
import { PengumumanPageClient } from "./PengumumanPageClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ keadaan?: string; q?: string }> };

function bacaKeadaan(raw: string | undefined): KeadaanPengumuman | undefined {
  return raw && (KEADAAN_PENGUMUMAN as readonly string[]).includes(raw) ? (raw as KeadaanPengumuman) : undefined;
}

/**
 * Pengumuman kantor ke tim lapangan (salesman, SPG, atau keduanya). Melihat =
 * `field_sales_orders:view`; membuat, mengubah, mengarsipkan =
 * `field_sales_orders:approve`.
 */
export default async function PengumumanPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const keadaan = bacaKeadaan(sp.keadaan);
  const q = sp.q?.trim().slice(0, 100) ?? "";
  const baris = await daftarPengumumanKantor({ keadaan, cari: q || undefined });

  return (
    <PengumumanPageClient
      baris={baris}
      keadaan={keadaan ?? "SEMUA"}
      q={q}
      terpotong={baris.length >= BATAS_DAFTAR_KANTOR ? BATAS_DAFTAR_KANTOR : null}
      canManage={hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)}
    />
  );
}

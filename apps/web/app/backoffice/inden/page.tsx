import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarJendelaInden } from "@/lib/field-sales/inden-queries";
import { KEADAAN_INDEN, type KeadaanInden } from "@/lib/field-sales/inden";
import { IndenPageClient } from "./IndenPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ keadaan?: string; q?: string }>;
};

function bacaKeadaan(raw: string | undefined): KeadaanInden | undefined {
  return raw && (KEADAAN_INDEN as readonly string[]).includes(raw) ? (raw as KeadaanInden) : undefined;
}

/**
 * Pre-order (inden) — jendela pesanan untuk barang yang belum ada di gudang.
 * Melihat = `field_sales_orders:view`; membuat, mengubah, dan merilis =
 * `field_sales_orders:approve` (keputusan atas pesanan toko, sama dengan menyetujui).
 */
export default async function IndenPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const keadaan = bacaKeadaan(sp.keadaan);
  const q = sp.q?.trim().slice(0, 100) ?? "";
  const baris = await daftarJendelaInden({ keadaan, cari: q || undefined });

  return (
    <IndenPageClient
      baris={baris}
      keadaan={keadaan ?? "ALL"}
      q={q}
      canManage={hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)}
    />
  );
}

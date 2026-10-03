import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaRentang } from "@/lib/salesman/metrik-lapangan";
import { kinerjaSemuaSales } from "@/lib/salesman/metrik-queries";
import { keAngka, labelRentang, paramRentang } from "./bentuk";
import { KinerjaSalesClient } from "./KinerjaSalesClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ rentang?: string | string[]; dari?: string | string[]; sampai?: string | string[] }>;
};

/**
 * Kinerja Sales Lapangan — dasbor atasan: satu baris per sales untuk rentang
 * yang dipilih (bawaan hari ini), baris total, alasan kunjungan tanpa
 * transaksi, dan ekspor Excel. Angkanya dihitung dengan aturan yang sama
 * dengan layar "Hari ini" di HP sales dan kabar ringkasan harian.
 */
export default async function KinerjaSalesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const { preset, rentang } = bacaRentang(sp, sekarang);
  const tim = await kinerjaSemuaSales(rentang, { sekarang });
  const q = paramRentang(preset, rentang);

  return (
    <KinerjaSalesClient
      filter={{ preset, dari: rentang.dari, sampai: rentang.sampai, label: labelRentang(rentang) }}
      baris={tim.baris.map((b) => ({
        salesmanId: b.salesmanId,
        nama: b.nama,
        href: `/backoffice/sales-lapangan/${encodeURIComponent(b.salesmanId)}?${q}`,
        angka: keAngka(b.metrik, b),
      }))}
      total={keAngka(tim.total)}
      hasil={tim.total.hasil.perKode}
      perTanda={tim.total.perTanda}
    />
  );
}

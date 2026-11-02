import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { bacaSaringanReturPembeli } from "@/lib/spg/retur-pembeli-status";
import { daftarReturPembeliKantor, pilihanTokoReturPembeli } from "@/lib/spg/retur-pembeli-queries";
import { DaftarReturPembeliClient, type BarisReturPembeliTampil } from "./DaftarReturPembeliClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string | string[]; toko?: string | string[]; cari?: string | string[]; halaman?: string | string[] }>;
};

/**
 * Retur pembeli SPG — kantor. Pengawas SPG (`spg_sales:view`, juga di
 * ROUTE_PERMISSIONS) melihat; menyetujui dan menolak = `spg_returns:approve`,
 * diperiksa di halaman rincian dan di aksinya. Saringan hidup di URL
 * (`?status=&toko=&cari=&halaman=`): halaman server membacanya, klien hanya
 * mendorong URL.
 */
export default async function ReturPembeliSpgPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const saringan = bacaSaringanReturPembeli(await searchParams);
  const [data, toko] = await Promise.all([daftarReturPembeliKantor(saringan), pilihanTokoReturPembeli()]);

  const baris: BarisReturPembeliTampil[] = data.baris.map((b) => ({
    id: b.id,
    status: b.status,
    dilaporkan: formatDisplayDateTime(b.dilaporkanPada),
    toko: b.toko,
    pelapor: b.pelapor,
    spgSaleId: b.spgSaleId,
    docNo: b.docNo,
    pcs: b.pcs,
    ringkasBarang: b.ringkasBarang,
    alasan: b.alasan,
    diputuskanOleh: b.diputuskanOleh,
    diputuskan: b.diputuskanPada ? formatDisplayDateTime(b.diputuskanPada) : null,
    alasanTolak: b.alasanTolak,
    langsungBerlaku: b.langsungBerlaku,
  }));

  return (
    <DaftarReturPembeliClient
      saringan={saringan}
      baris={baris}
      total={data.total}
      perStatus={data.perStatus}
      toko={toko}
      bolehMemutuskan={hasPermission(izin, PERMISSIONS.SPG_RETURNS_APPROVE)}
    />
  );
}

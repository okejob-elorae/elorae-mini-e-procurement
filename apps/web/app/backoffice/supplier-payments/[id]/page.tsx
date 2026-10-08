import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianPembayaran } from "@/lib/purchasing/pembayaran-queries";
import { bacaHutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import { RincianPembayaranClient } from "./RincianPembayaranClient";

export const dynamic = "force-dynamic";

/**
 * Rincian satu pembayaran pemasok: alokasi per dokumen, potongan PPh, jurnal,
 * uang muka yang belum terpakai (bisa diterapkan ke dokumen hutang lain), dan
 * pembatalan (jurnal pembalik). Melihat `supplier_payments:view`; membatalkan
 * dan menerapkan uang muka `supplier_payments:edit`.
 */
export default async function RincianPembayaranPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const b = await rincianPembayaran(id);
  if (!b) notFound();
  const ubah = hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_EDIT);
  const hutang = ubah && b.status === "POSTED" && !b.cerminTandaiLunas && b.uangMukaSisa > 0 ? (await bacaHutangPemasok({ supplierIds: [b.pemasok.id] })).pemasok[0] ?? null : null;
  return (
    <RincianPembayaranClient
      bayar={b}
      dokumenTerbuka={(hutang?.dokumen ?? []).filter((d) => d.sisaSen > 0)}
      akses={{ ubah, lihatJurnal: hasPermission(izin, PERMISSIONS.JOURNALS_VIEW) }}
    />
  );
}

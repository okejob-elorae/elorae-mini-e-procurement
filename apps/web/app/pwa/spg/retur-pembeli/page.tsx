import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { returPembeliSaya } from "@/lib/spg/retur-pembeli-queries";
import { ReturPembeliSayaClient } from "./ReturPembeliSayaClient";

export const dynamic = "force-dynamic";

/**
 * Laporan barang kembali dari pembeli milik SPG ini, dengan statusnya: menunggu kantor,
 * disetujui, ditolak, atau ditarik. Hanya laporannya sendiri di toko tetapnya — toko diambil dari
 * `User.assignedStoreId`, tidak pernah dari HP — dan tanpa harga atau total.
 */
export default async function ReturPembeliSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) redirect("/pwa");
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) redirect("/pwa");

  const laporan = await returPembeliSaya(session.user.id, storeId);
  return <ReturPembeliSayaClient laporan={laporan} />;
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaStatusMutasi } from "@/lib/spg/mutasi-aturan";
import { daftarMutasiKantor } from "@/lib/spg/mutasi-queries";
import { DaftarMutasiClient } from "./DaftarMutasiClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; selisih?: string; q?: string }>;
};

/**
 * Mutasi antar toko — kantor. Penyetuju lapangan menyetujui/menolak, mengalihkan,
 * membatalkan dan memutuskan selisih; pengelola toko menerima atas nama toko
 * tanpa SPG. Satu daftar, disaring lewat alamat.
 */
export default async function SpgTransfersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaStatusMutasi(sp.status);
  const selisih = sp.selisih === "1";
  const cari = sp.q?.trim().slice(0, 100) || null;
  const data = await daftarMutasiKantor({ status, selisih, cari });

  return <DaftarMutasiClient status={status} selisih={selisih} cari={cari} data={data} />;
}

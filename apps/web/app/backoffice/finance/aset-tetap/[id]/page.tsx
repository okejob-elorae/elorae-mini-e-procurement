import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { akunUntukAset, rincianAset } from "@/lib/finance/aset/queries";
import { RincianAsetClient } from "./RincianAsetClient";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * Keuangan → Aset tetap → rincian satu aset: nilai, jadwal penyusutan per
 * bulan (diposting / belum / bulan ditutup), jurnal perolehan dan pelepasan,
 * riwayat. Melihat `journals:view`; melepas, membatalkan, memposting
 * `journals:manage`.
 */
export default async function RincianAsetPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const bolehMengelola = hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE);
  const [aset, akun] = await Promise.all([rincianAset(id), bolehMengelola ? akunUntukAset() : Promise.resolve([])]);
  if (!aset) notFound();
  const rekening = akun.filter((a) => a.tipe === "ASET");
  return <RincianAsetClient aset={aset} rekening={rekening} hariIni={hariIniWib()} bolehMengelola={bolehMengelola} />;
}

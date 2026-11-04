import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { bulanSah } from "@/lib/salesman/target-rinci";
import { kinerjaSpgHarian } from "@/lib/spg/kinerja-queries";
import { RincianKinerjaSpgClient } from "./RincianKinerjaSpgClient";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ userId: string }>; searchParams: Promise<{ bulan?: string }> };

/**
 * Rincian harian kinerja satu SPG satu bulan (`?bulan=YYYY-MM`, bawaan bulan
 * ini): jadwal dan jam masuk, penjualan, pengunjung dan konversi, tutup hari,
 * titip pesan — satu bagian per toko tempat ia bekerja bulan itu.
 */
export default async function RincianKinerjaSpgPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  const sekarang = new Date();
  const bulanIni = bulanWib(sekarang);
  const bulan = bulanSah(sp.bulan) && sp.bulan <= bulanIni ? sp.bulan : bulanIni;

  const data = await kinerjaSpgHarian({ userId, bulan, sekarang });
  if (!data) notFound();
  return <RincianKinerjaSpgClient data={data} />;
}

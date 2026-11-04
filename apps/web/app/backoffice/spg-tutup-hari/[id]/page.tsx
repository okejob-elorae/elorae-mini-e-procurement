import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { labelHariTutup } from "@/lib/spg/tutup-hari";
import { rincianTutupHariKantor } from "@/lib/spg/tutup-hari-queries";
import { RincianTutupHariClient } from "./RincianTutupHariClient";

export const dynamic = "force-dynamic";

/**
 * Rincian satu laporan tutup hari: isi laporan (angka saat dikirim + isian
 * SPG), angka sistem saat ini bila berbeda, per SPG, terlaris, kiriman,
 * barang dicari, dan riwayat setiap kiriman (sebelum → sesudah).
 */
export default async function RincianSpgTutupHariPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const rincian = await rincianTutupHariKantor(id);
  if (!rincian) notFound();

  return <RincianTutupHariClient rincian={rincian} labelHari={labelHariTutup(rincian.laporan.day)} />;
}

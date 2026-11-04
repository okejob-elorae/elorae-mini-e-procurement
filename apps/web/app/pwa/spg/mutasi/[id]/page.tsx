import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { rincianMutasiHp } from "@/lib/spg/mutasi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { RincianMutasiClient } from "./RincianMutasiClient";

export const dynamic = "force-dynamic";

/**
 * Satu mutasi di HP SPG. Hanya terbuka untuk SPG toko asal atau tujuannya;
 * toko tujuan baru melihatnya sesudah barang berangkat.
 */
export default async function SpgRincianMutasiPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const { id } = await params;
  const [rincian, aktif] = await Promise.all([rincianMutasiHp(id, toko.id), getActiveVisit(session.user.id)]);
  const kunjungan = aktif && aktif.storeId === toko.id ? { id: aktif.id, checkinAtMs: aktif.checkinAt.getTime() } : null;
  return <RincianMutasiClient storeId={toko.id} kunjunganServer={kunjungan} rincian={rincian} sudahCheckIn={kunjungan !== null} />;
}

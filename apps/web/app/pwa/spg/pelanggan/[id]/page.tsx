import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { rincianPelangganHp } from "@/lib/spg/pelanggan-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { RincianPelangganClient } from "./RincianPelangganClient";

export const dynamic = "force-dynamic";

/** Satu pelanggan toko SPG; pelanggan toko lain tampil sebagai "tidak ditemukan". */
export default async function SpgRincianPelangganPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/pelanggan");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const { id } = await params;
  const rincian = await rincianPelangganHp(toko.id, id);
  return <RincianPelangganClient rincian={rincian} />;
}

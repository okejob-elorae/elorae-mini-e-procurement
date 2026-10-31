import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { rincianRekomendasiSpg } from "@/lib/salesman/rekomendasi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { RincianRekomendasiSpgClient } from "./RincianRekomendasiSpgClient";

export const dynamic = "force-dynamic";

/**
 * Satu rekomendasi untuk SPG — hanya terbuka untuk SPG yang toko tetapnya
 * toko rekomendasi itu. Menerima atau menolak (alasan wajib) selama masih
 * menunggu jawaban.
 */
export default async function SpgRincianRekomendasiPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const { id } = await params;
  return <RincianRekomendasiSpgClient rincian={await rincianRekomendasiSpg(id, toko.id)} />;
}

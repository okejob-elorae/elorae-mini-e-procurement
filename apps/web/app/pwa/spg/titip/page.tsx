import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { daftarTitipHp } from "@/lib/spg/titip-queries";
import { DaftarTitipClient, type TabTitip } from "./DaftarTitipClient";

export const dynamic = "force-dynamic";

const TAB: TabTitip[] = ["datang", "dikabari", "menunggu"];

/**
 * Titip pesan toko SPG: pembeli yang minta dikabari saat barangnya datang.
 * "Sudah datang" dihitung dari buku stok toko SAAT dibuka. Tanpa harga.
 */
export default async function SpgTitipPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/titip");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const sp = await searchParams;
  const data = await daftarTitipHp(toko.id);
  const diminta = TAB.find((t) => t === sp.tab);
  // Tanpa pilihan: buka yang menunggu tindakan lebih dulu.
  const tab: TabTitip = diminta ?? (data.datang.length > 0 ? "datang" : data.dikabari.length > 0 ? "dikabari" : "menunggu");
  return <DaftarTitipClient namaToko={toko.name} tab={tab} data={data} />;
}

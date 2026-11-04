import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { daftarPelangganHp } from "@/lib/spg/pelanggan-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { DaftarPelangganClient } from "./DaftarPelangganClient";

export const dynamic = "force-dynamic";

/**
 * Pelanggan toko SPG: pembeli yang mau dihubungi lewat WhatsApp. Milik TOKO,
 * bukan milik SPG — rekan setoko melihat daftar yang sama. Toko selalu toko
 * tetap SPG; pelanggan toko lain tidak pernah dimuat.
 */
export default async function SpgPelangganPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/pelanggan");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 60) || null;
  const data = await daftarPelangganHp(toko.id, { q });
  return <DaftarPelangganClient namaToko={toko.name} q={q} data={data} />;
}

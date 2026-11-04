import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { daftarRekomendasiSpg } from "@/lib/salesman/rekomendasi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { RekomendasiSpgClient } from "./RekomendasiSpgClient";

export const dynamic = "force-dynamic";

/**
 * Rekomendasi dari sales untuk toko tetap SPG ini — yang menunggu jawaban di
 * atas. Tokonya selalu toko tetap SPG dari server; pengguna tanpa toko tetap
 * dikembalikan ke berandanya.
 */
export default async function SpgRekomendasiPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const data = await daftarRekomendasiSpg(toko.id);
  return <RekomendasiSpgClient namaToko={toko.name} baris={data.baris} menunggu={data.menunggu} />;
}

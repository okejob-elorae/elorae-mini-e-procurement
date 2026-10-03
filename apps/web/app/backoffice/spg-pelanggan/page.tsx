import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pelangganTokoKantor, ringkasPelangganKantor } from "@/lib/spg/pelanggan-kantor";
import { ringkasTitipKantor } from "@/lib/spg/titip-kantor";
import { PelangganKantorClient } from "./PelangganKantorClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tab?: string; toko?: string }> };

/**
 * Pelanggan & titip pesan SPG — kantor (`spg_sales:view`). Tab Pelanggan: per
 * toko berapa pembeli tercatat dan seberapa sering mereka belanja; pilih toko
 * untuk melihat daftarnya (nomor HP disamarkan). Tab Titip pesan: per toko
 * berapa permintaan di tiap status dan barang yang paling sering dititip.
 */
export default async function SpgPelangganKantorPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const tab = sp.tab === "titip" ? "titip" : "pelanggan";
  const tokoId = tab === "pelanggan" && sp.toko ? sp.toko.slice(0, 100) : null;

  const [ringkas, titip, perToko] = await Promise.all([
    tab === "pelanggan" ? ringkasPelangganKantor() : Promise.resolve([]),
    tab === "titip" ? ringkasTitipKantor() : Promise.resolve([]),
    tokoId ? pelangganTokoKantor(tokoId) : Promise.resolve(null),
  ]);

  return <PelangganKantorClient tab={tab} ringkas={ringkas} titip={titip} perToko={perToko?.toko ? perToko : null} />;
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pilihanCampaign } from "@/lib/creative/campaign-queries";
import { daftarKolHalaman, pilihanSaringKol } from "@/lib/creative/kol-queries";
import { alamatMemilihTampilanKol, bacaSaringKol, type ParamSaringKol } from "@/lib/creative/kol-saring";
import { KolClient } from "./KolClient";

export const dynamic = "force-dynamic";

/**
 * Database KOL. Seluruh saringan, urutan, halaman, dan tampilan dibaca dari
 * alamat, jadi daftar yang tampil pertama sudah tersaring dan bisa dibagikan.
 */
export default async function KolPage({ searchParams }: { searchParams: Promise<ParamSaringKol> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const bolehMengelola = hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE);

  const sp = await searchParams;
  const saring = bacaSaringKol(sp);
  const [hasil, pilihan, campaign] = await Promise.all([
    daftarKolHalaman(saring),
    pilihanSaringKol(),
    bolehMengelola ? pilihanCampaign() : Promise.resolve([]),
  ]);

  return (
    <KolClient
      hasil={hasil}
      saring={{ ...saring, halaman: hasil.halaman }}
      tampilanDariAlamat={alamatMemilihTampilanKol(sp)}
      pilihan={pilihan}
      campaign={campaign.filter((c) => !c.arsip)}
      bolehMengelola={bolehMengelola}
      userId={session.user.id}
    />
  );
}

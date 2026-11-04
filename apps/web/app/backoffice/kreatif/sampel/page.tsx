import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarSampel, pilihanCampaignSampel } from "@/lib/creative/sampel-queries";
import { bacaParamSampel } from "./param";
import { SampelClient } from "./SampelClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Sampel — antrean kirim sampel ke KOL: Perlu dikirim → Dalam perjalanan →
 * Sudah sampai. Tab, kata kunci, campaign, kolaborasi, dan halaman dibaca dari
 * alamat, jadi tautan dari Hari ini membuka antrean yang sama dengan angkanya.
 */
export default async function SampelPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const param = bacaParamSampel(await searchParams);
  const [data, campaign] = await Promise.all([
    daftarSampel({
      tab: param.tab,
      cari: param.cari,
      campaignId: param.campaign,
      kolaborasiId: param.kolaborasi,
      halaman: param.halaman,
    }),
    pilihanCampaignSampel(),
  ]);

  return (
    <SampelClient
      param={{ ...param, halaman: data.halaman }}
      data={data}
      campaign={campaign}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

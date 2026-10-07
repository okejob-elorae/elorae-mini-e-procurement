import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { detailCampaign, pilihanCampaign } from "@/lib/creative/campaign-queries";
import { PARAM_KOLABORASI_AWAL } from "@/lib/creative/kolaborasi-param";
import { daftarKolaborasi, pilihanPic } from "@/lib/creative/kolaborasi-queries";
import { DetailCampaignClient } from "./DetailCampaignClient";

export const dynamic = "force-dynamic";

/** Rincian satu campaign KOL beserta kolaborasinya (25 terbaru; sisanya di daftar Kolaborasi). */
export default async function DetailCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const campaign = await detailCampaign(id);
  if (!campaign) notFound();

  const hariIni = hariIniWib();
  const ambang = await bacaAmbangKreatif();
  const [kolaborasi, campaigns, pics] = await Promise.all([
    daftarKolaborasi({ ...PARAM_KOLABORASI_AWAL, campaign: id }, { hariIni, ambang }),
    pilihanCampaign(),
    pilihanPic(),
  ]);

  return (
    <DetailCampaignClient
      campaign={campaign}
      kolaborasi={kolaborasi}
      campaigns={campaigns}
      pics={pics}
      hariIni={hariIni}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
      userId={session.user.id}
    />
  );
}

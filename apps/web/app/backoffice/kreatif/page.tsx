import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { kpiKreatif, pilihanCampaignKreatif, tugasKreatif } from "@/lib/creative/tugas-queries";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaParamHariIni } from "./hari-ini";
import { HariIniClient } from "./HariIniClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Hari ini — layar bawaan Ruang KOL: angka periode, apa yang perlu
 * ditindaklanjuti (13 kelompok dari `susunTugas`), dan posisi tahap.
 * Periode dan campaign ada di alamat (`?periode=&dari=&sampai=&campaign=`).
 * Daftar tugas dibaca lewat `tugasKreatif` yang ber-`cache`, jadi lencana tab
 * di tata letak dan halaman ini berbagi satu bacaan.
 */
export default async function HariIniKreatifPage({ searchParams }: PageProps) {
  const session = await auth();
  const izin = session?.user.permissions ?? [];
  if (!session?.user?.id || !hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamHariIni(await searchParams, hariIni);
  const [kelompok, kpi, campaign, ambang] = await Promise.all([
    tugasKreatif(session.user.id, hariIni),
    kpiKreatif({ periode: { dari: param.dari, sampai: param.sampai }, campaignId: param.campaign }),
    pilihanCampaignKreatif(param.campaign),
    bacaAmbangKreatif(),
  ]);

  return (
    <HariIniClient
      param={param}
      hariIni={hariIni}
      kelompok={kelompok}
      kpi={kpi}
      campaign={campaign}
      umurMerahHari={ambang.umurTahapMerahHari}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

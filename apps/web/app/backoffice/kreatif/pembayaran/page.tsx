import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { daftarPembayaran, pilihanCampaignBayar } from "@/lib/creative/bayar-queries";
import { bacaParamBayar } from "@/lib/creative/laporan-param";
import { PembayaranClient } from "./PembayaranClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Pembayaran KOL — tagihan fee per kolaborasi. Chip, pencarian, campaign, dan
 * halaman dibaca dari alamat (`?chip=&cari=&campaign=&halaman=&per=`), jadi
 * tautan yang dibagikan membuka daftar yang sama.
 */
export default async function PembayaranPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamBayar(await searchParams);
  const [data, campaign] = await Promise.all([
    daftarPembayaran({ chip: param.chip, cari: param.cari, campaignId: param.campaign, halaman: param.halaman, perHalaman: param.per }, hariIni),
    pilihanCampaignBayar(param.campaign),
  ]);

  return (
    <PembayaranClient
      param={{ ...param, halaman: data.halaman }}
      data={data}
      campaign={campaign}
      hariIni={hariIni}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

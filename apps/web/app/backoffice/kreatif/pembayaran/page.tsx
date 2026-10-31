import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { pilihanCampaignBayar } from "@/lib/creative/bayar-queries";
import { bacaParamTermin } from "@/lib/creative/termin-param";
import { daftarTermin } from "@/lib/creative/termin-queries";
import { PembayaranClient } from "./PembayaranClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Pembayaran KOL per TERMIN (bruto, PPh, neto, jatuh tempo, bukti). Saringan
 * dibaca dari alamat (`?chip=&cari=&campaign=&kolaborasi=&halaman=&per=`),
 * jadi tautan yang dibagikan — termasuk pintasan "Bayar" dari Hari ini —
 * membuka daftar yang sama.
 */
export default async function PembayaranPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamTermin(await searchParams);
  const [data, campaign, kolaborasi] = await Promise.all([
    daftarTermin(
      { chip: param.chip, cari: param.cari, campaignId: param.campaign, kolaborasiId: param.kolaborasi, halaman: param.halaman, perHalaman: param.per },
      hariIni,
    ),
    pilihanCampaignBayar(param.campaign),
    param.kolaborasi ? prisma.kolBrief.findUnique({ where: { id: param.kolaborasi }, select: { docNo: true } }) : Promise.resolve(null),
  ]);

  return (
    <PembayaranClient
      param={{ ...param, halaman: data.halaman }}
      data={data}
      campaign={campaign}
      kolaborasiDocNo={kolaborasi?.docNo ?? null}
      hariIni={hariIni}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE) || hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}

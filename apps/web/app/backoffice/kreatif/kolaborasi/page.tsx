import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { pilihanCampaign } from "@/lib/creative/campaign-queries";
import { alamatMemilihTampilan, bacaParamKolaborasi } from "@/lib/creative/kolaborasi-param";
import { daftarKolaborasi, pilihanPic } from "@/lib/creative/kolaborasi-queries";
import { KolaborasiClient } from "./KolaborasiClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Daftar Kolaborasi (Ruang KOL). Keadaan dibaca dari alamat
 * (`?tahap=&campaign=&platform=&pic=&cari=&tampilan=&halaman=`), jadi tautan
 * "Lihat kolaborasi" dari Campaign membuka daftar yang sudah tersaring.
 */
export default async function KolaborasiPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const param = bacaParamKolaborasi(sp);
  const hariIni = hariIniWib();
  const ambang = await bacaAmbangKreatif();
  const [data, campaigns, pics] = await Promise.all([
    daftarKolaborasi(param, { hariIni, ambang }),
    pilihanCampaign(),
    pilihanPic(),
  ]);

  return (
    <KolaborasiClient
      param={{ ...param, halaman: data.halaman }}
      data={data}
      campaigns={campaigns}
      pics={pics}
      hariIni={hariIni}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
      userId={session.user.id}
      tampilanDariAlamat={alamatMemilihTampilan(sp)}
    />
  );
}

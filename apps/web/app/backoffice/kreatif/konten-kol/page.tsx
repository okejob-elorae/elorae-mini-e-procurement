import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { bacaParamKontenKol } from "@/lib/creative/konten-kol";
import {
  campaignUntukSaringan,
  daftarKontenKol,
  hitungKontenKol,
  jadwalTayang,
  labelKolaborasi,
} from "@/lib/creative/konten-kol-queries";
import { KontenKolClient } from "./KontenKolClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Konten KOL — antrean konten dari KOL: menunggu konten, draf masuk, draf
 * disetujui yang belum tayang, sudah tayang (isi angka), dan jadwal tayang.
 * Tab, pencarian, campaign, kolaborasi, halaman, dan bulan tinggal di alamat
 * (`?tab=&cari=&campaign=&kolaborasi=&halaman=&bulan=`), jadi tautan dari
 * Hari ini (`?tab=draf&kolaborasi=<id>`) dan tautan yang dibagikan membuka
 * keadaan yang sama.
 */
export default async function KontenKolPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamKontenKol(await searchParams, hariIni);
  const filter = { cari: param.cari, campaignId: param.campaign, kolaborasiId: param.kolaborasi };
  const ambang = await bacaAmbangKreatif();

  const [hitungan, campaign, kolaborasiLabel, daftar, jadwal] = await Promise.all([
    hitungKontenKol(filter),
    campaignUntukSaringan(),
    labelKolaborasi(param.kolaborasi),
    param.chip === "jadwal" ? null : daftarKontenKol(param.chip, filter, { halaman: param.halaman, hariIni, ambang }),
    param.chip === "jadwal" ? jadwalTayang(param.bulan, filter) : null,
  ]);

  return (
    <KontenKolClient
      param={daftar ? { ...param, halaman: daftar.halaman } : param}
      hariIni={hariIni}
      ambang={ambang}
      hitungan={hitungan}
      campaign={campaign}
      kolaborasiLabel={kolaborasiLabel}
      daftar={daftar}
      jadwal={jadwal}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

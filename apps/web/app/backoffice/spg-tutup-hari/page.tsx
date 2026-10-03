import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { hariSah, labelHariTutup } from "@/lib/spg/tutup-hari";
import { daftarTutupHariKantor, rekapTutupHariKantor } from "@/lib/spg/tutup-hari-queries";
import { TutupHariKantorClient } from "./TutupHariKantorClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ hari?: string; dari?: string; sampai?: string }> };

/**
 * Tutup hari SPG — kantor. Per hari (bawaan hari ini WIB): setiap toko yang
 * punya SPG, sudah/belum tutup, angka laporannya, pengunjung, konversi, kasir
 * dan selisihnya. Rentang (`?dari=&sampai=`): rekap per toko. Tanggal masa
 * depan dijepit ke hari ini.
 */
export default async function SpgTutupHariPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const jepit = (d: string) => (d > hariIni ? hariIni : d);

  if (hariSah(sp.dari) && hariSah(sp.sampai)) {
    const rekap = await rekapTutupHariKantor(jepit(sp.dari), jepit(sp.sampai));
    return <TutupHariKantorClient mode="rentang" hariIni={hariIni} rekap={rekap} label={`${labelHariTutup(rekap.dari)} – ${labelHariTutup(rekap.sampai)}`} />;
  }

  const day = hariSah(sp.hari) ? jepit(sp.hari) : hariIni;
  const data = await daftarTutupHariKantor(day);
  return <TutupHariKantorClient mode="hari" hariIni={hariIni} data={data} label={labelHariTutup(day)} />;
}

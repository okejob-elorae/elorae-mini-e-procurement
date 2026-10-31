import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { memberKantor, pelangganTokoKantor, ringkasPelangganKantor } from "@/lib/spg/pelanggan-kantor";
import { bacaPeriodeHari, bacaSaringMember, bacaSaringStatusMember, bacaStatusPelanggan } from "@/lib/spg/pelanggan-lacak";
import { ringkasTitipKantor } from "@/lib/spg/titip-kantor";
import { bacaCari, bacaHalaman } from "../piutang/_daftar/halaman";
import { PelangganKantorClient } from "./PelangganKantorClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string; toko?: string; periode?: string; status?: string; member?: string; cari?: string; halaman?: string }>;
};

/**
 * Pelanggan, member & titip pesan SPG — kantor (`spg_sales:view`).
 *
 * - Tab Pelanggan: ringkasan pelacakan per toko dan semua toko dalam periode
 *   (`?periode=` 30/90/180/365 hari, bawaan 90): cakupan pencatatan, pelanggan
 *   kembali, belanja pertama, tidur, member. `?toko=` membuka daftar pelanggan
 *   toko itu dengan status, tingkat member, dan kategori favorit — disaring
 *   (`?status=`, `?member=`, `?cari=`) dan dipotong (`?halaman=`) di server.
 * - Tab Member (`?tab=member`): member Elorae di semua toko; kantor
 *   menonaktifkan (dengan alasan) dan mengaktifkan kembali.
 * - Tab Titip pesan (`?tab=titip`).
 *
 * Nomor HP pembeli selalu disamarkan.
 */
export default async function SpgPelangganKantorPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const tab = sp.tab === "titip" ? "titip" : sp.tab === "member" ? "member" : "pelanggan";
  const tokoId = tab === "pelanggan" && sp.toko ? sp.toko.slice(0, 100) : null;
  const periodeHari = bacaPeriodeHari(sp.periode);
  const cari = bacaCari(sp.cari);
  const halaman = bacaHalaman(sp.halaman);
  const sekarang = new Date();

  const perToko = tokoId
    ? await pelangganTokoKantor(tokoId, {
        sekarang,
        periodeHari,
        cari,
        status: bacaStatusPelanggan(sp.status),
        member: bacaSaringMember(sp.member),
        halaman,
      })
    : null;
  const [ringkas, member, titip] = await Promise.all([
    tab === "pelanggan" && !perToko ? ringkasPelangganKantor({ sekarang, periodeHari }) : Promise.resolve(null),
    tab === "member" ? memberKantor({ sekarang, cari, status: bacaSaringStatusMember(sp.status), halaman }) : Promise.resolve(null),
    tab === "titip" ? ringkasTitipKantor() : Promise.resolve([]),
  ]);

  return (
    <PelangganKantorClient
      tab={tab}
      bolehAturMember={hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)}
      periodeHari={periodeHari}
      cari={cari}
      saring={{ status: bacaStatusPelanggan(sp.status), member: bacaSaringMember(sp.member), statusMember: bacaSaringStatusMember(sp.status) }}
      ringkas={ringkas}
      perToko={perToko}
      member={member}
      titip={titip}
    />
  );
}

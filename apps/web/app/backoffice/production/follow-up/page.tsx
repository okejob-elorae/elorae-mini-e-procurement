import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilKalenderKerja } from "@/lib/production/jadwal-pengaturan";
import { followUpProduksi } from "@/lib/production/jadwal-queries";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaParamFollowUp } from "./follow-up";
import { pemasokFollowUp } from "./pemasok";
import { FollowUpClient } from "./FollowUpClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Follow-up produksi — langkah jadwal proses yang belum selesai, lintas tahap.
 * Tab dan saringan dibaca dari alamat (`?saring=`, `?pemasok=`, `?halaman=`),
 * jadi tautan Beranda ("Proses produksi terlambat") membuka daftar yang sama
 * dengan angkanya: keduanya memakai `whereFollowUp`.
 */
export default async function FollowUpProduksiPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PRODUCTION_PLANNING_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamFollowUp(await searchParams, hariIni);
  const [data, pemasok, kalender] = await Promise.all([
    followUpProduksi({ saring: param.saring, supplierId: param.pemasok, halaman: param.halaman }),
    pemasokFollowUp(param.pemasok),
    ambilKalenderKerja(),
  ]);

  return (
    <FollowUpClient
      param={{ ...param, halaman: data.halaman }}
      hariIni={hariIni}
      data={data}
      pemasok={pemasok}
      hariKerja={kalender.hariKerja}
      tanggalMerah={kalender.tanggalMerah}
      bolehUbah={hasPermission(izin, PERMISSIONS.PRODUCTION_PLANNING_MANAGE)}
    />
  );
}

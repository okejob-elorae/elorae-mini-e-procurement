import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaKunciBulan, kunciBulan, type DaftarPeriksa } from "@/lib/finance/periode/periode";
import { bacaDaftarPeriksa, daftarPeriode, type DaftarPeriode } from "@/lib/finance/periode/queries";
import { TutupBukuClient } from "./TutupBukuClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bulan?: string | string[] }> };

/**
 * Keuangan → Tutup buku: daftar bulan dan tahun buku, daftar periksa sebelum
 * menutup bulan (`?bulan=YYYY-MM`), tutup / buka kembali bulan, tutup / buka
 * tahun. Melihat `journals:view`; mengubah `journals:manage`.
 */
export default async function TutupBukuPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const dipilih = bacaKunciBulan(Array.isArray(sp.bulan) ? sp.bulan[0] : sp.bulan);

  let data: DaftarPeriode | null = null;
  let periksa: DaftarPeriksa | null = null;
  try {
    [data, periksa] = await Promise.all([daftarPeriode(), dipilih ? bacaDaftarPeriksa(dipilih) : Promise.resolve(null)]);
  } catch (err) {
    console.error("[tutup-buku] gagal memuat", err);
  }

  return (
    <TutupBukuClient
      data={data}
      dipilih={dipilih ? kunciBulan(dipilih) : null}
      periksa={periksa}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}

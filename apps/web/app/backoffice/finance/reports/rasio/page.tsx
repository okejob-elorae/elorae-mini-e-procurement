import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { periodeBulanBerjalan } from "@/lib/finance/reports/param-laporan";
import { muatRasio } from "@/lib/finance/reports/rasio-queries";
import { RasioClient } from "./RasioClient";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ dari?: string; sampai?: string }> };

export default async function RasioPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const periode = periodeBulanBerjalan(sp, hariIniWib());
  const [laporan, kesiapan] = await Promise.all([muatRasio(periode), bacaKesiapanBukuBesar()]);

  return (
    <RasioClient
      laporan={laporan}
      filters={{ dari: sp.dari ?? "", sampai: sp.sampai ?? "" }}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
      bolehKlasifikasi={hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)}
    />
  );
}

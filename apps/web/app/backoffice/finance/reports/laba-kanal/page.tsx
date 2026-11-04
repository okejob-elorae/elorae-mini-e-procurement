import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { bacaKelompok, bacaSaringKanal, periodeBulanBerjalan } from "@/lib/finance/reports/param-laporan";
import { muatLabaKanal } from "@/lib/finance/reports/laba-kanal-queries";
import { LabaKanalClient } from "./LabaKanalClient";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ dari?: string; sampai?: string; kelompok?: string; kanal?: string }> };

export default async function LabaKanalPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const periode = periodeBulanBerjalan(sp, hariIniWib());
  const kelompok = bacaKelompok(sp.kelompok);
  const kanal = bacaSaringKanal(sp.kanal);
  const [laporan, kesiapan] = await Promise.all([
    muatLabaKanal({ from: parseDateOnly(periode.dari), to: parseDateOnlyEnd(periode.sampai)!, kelompok, kanal }),
    bacaKesiapanBukuBesar(),
  ]);

  return (
    <LabaKanalClient
      laporan={laporan}
      periode={periode}
      filters={{ dari: sp.dari ?? "", sampai: sp.sampai ?? "", kelompok, kanal }}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
    />
  );
}

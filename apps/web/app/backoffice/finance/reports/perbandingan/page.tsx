import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaJenisPerbandingan, bacaTampilkanNol, periodeBulanBerjalan } from "@/lib/finance/reports/param-laporan";
import { tanggalSah } from "@/lib/finance/reports/periode-banding";
import { muatPerbandinganLabaRugi, muatPerbandinganNeraca } from "@/lib/finance/reports/perbandingan-queries";
import { PerbandinganClient } from "./PerbandinganClient";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ jenis?: string; dari?: string; sampai?: string; tanggal?: string; nol?: string }>;
};

export default async function PerbandinganPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const jenis = bacaJenisPerbandingan(sp.jenis);
  const hariIni = hariIniWib();
  const periode = periodeBulanBerjalan(sp, hariIni);
  const tanggal = tanggalSah(sp.tanggal) ?? hariIni;

  const [laba, neraca, kesiapan] = await Promise.all([
    jenis === "laba-rugi" ? muatPerbandinganLabaRugi(periode) : Promise.resolve(null),
    jenis === "neraca" ? muatPerbandinganNeraca(tanggal) : Promise.resolve(null),
    bacaKesiapanBukuBesar(),
  ]);

  return (
    <PerbandinganClient
      jenis={jenis}
      laba={laba}
      neraca={neraca}
      filters={{ dari: sp.dari ?? "", sampai: sp.sampai ?? "", tanggal: sp.tanggal ?? "", nol: bacaTampilkanNol(sp.nol) }}
      periode={periode}
      tanggal={tanggal}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
    />
  );
}

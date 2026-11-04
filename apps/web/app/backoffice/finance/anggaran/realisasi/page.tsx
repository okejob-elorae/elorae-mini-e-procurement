import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaTahunBulan, bacaTampilkanNol } from "@/lib/finance/reports/param-laporan";
import { muatRealisasiVsAnggaran } from "@/lib/finance/anggaran/queries";
import { RealisasiAnggaranClient } from "./RealisasiAnggaranClient";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../../_kesiapan/baca";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tahun?: string; bulan?: string; cakupan?: string; nol?: string }> };

/** Realisasi vs anggaran — laporan, dibuka pembaca laporan keuangan. */
export default async function RealisasiAnggaranPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const p = bacaTahunBulan(sp, hariIni);
  const tahunIni = Number(hariIni.slice(0, 4));
  const [laporan, kesiapan] = await Promise.all([muatRealisasiVsAnggaran(p), bacaKesiapanBukuBesar()]);

  return (
    <RealisasiAnggaranClient
      laporan={laporan}
      pilihan={{ tahun: p.tahun, bulan: p.bulan, cakupan: p.cakupan, nol: bacaTampilkanNol(sp.nol) }}
      tahunPilihan={[...new Set([tahunIni - 2, tahunIni - 1, tahunIni, tahunIni + 1, p.tahun])].sort((a, b) => a - b)}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
      bolehIsi={hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)}
    />
  );
}

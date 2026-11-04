import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaTahunBulan } from "@/lib/finance/reports/param-laporan";
import { bacaAnggaranTahun, daftarAkunAnggaran } from "@/lib/finance/anggaran/queries";
import { AnggaranClient } from "./AnggaranClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tahun?: string }> };

/** Isi anggaran per akun per bulan. Melihat `journals:view`, menyimpan `journals:manage`. */
export default async function AnggaranPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const { tahun } = bacaTahunBulan({ tahun: sp.tahun }, hariIni);
  const tahunIni = Number(hariIni.slice(0, 4));
  const [akun, anggaran] = await Promise.all([daftarAkunAnggaran(tahun), bacaAnggaranTahun(tahun)]);

  return (
    <AnggaranClient
      key={tahun}
      tahun={tahun}
      tahunPilihan={[...new Set([tahunIni - 2, tahunIni - 1, tahunIni, tahunIni + 1, tahunIni + 2, tahun])].sort((a, b) => a - b)}
      akun={akun}
      anggaran={Object.fromEntries(anggaran)}
      bolehUbah={hasPermission(permissions, PERMISSIONS.JOURNALS_MANAGE)}
      bolehLaporan={hasPermission(permissions, PERMISSIONS.FINANCE_REPORTS_VIEW)}
    />
  );
}

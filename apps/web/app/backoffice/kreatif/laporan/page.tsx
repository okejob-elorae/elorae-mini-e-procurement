import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaParamLaporan, bacaUrutPeringkat } from "@/lib/creative/laporan-param";
import { periodeRekap } from "@/lib/creative/laporan-periode";
import { awalSemuaKreatif, dataRekap, peringkatKol } from "@/lib/creative/laporan-queries";
import { susunRekap } from "@/lib/creative/rekap";
import { LaporanKreatifClient } from "./LaporanKreatifClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Laporan Ruang KOL: Peringkat KOL dan Rekap siap tempel. Tab, periode,
 * pencarian, urutan, dan halaman dibaca dari alamat; hanya tab yang terbuka
 * yang dihitung.
 */
export default async function LaporanPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const hariIni = hariIniWib();
  const param = bacaParamLaporan(await searchParams, hariIni);
  const urut = bacaUrutPeringkat(param.urut);

  if (param.tab === "rekap") {
    const rentang = periodeRekap(param.rentang, param.rentang ? null : await awalSemuaKreatif(), hariIni);
    const data = await dataRekap({ dari: rentang.dari, sampai: rentang.sampai, userId: session.user.id });
    return <LaporanKreatifClient param={{ ...param, urut }} hariIni={hariIni} rekap={{ teks: susunRekap(data), rentang }} />;
  }

  const peringkat = await peringkatKol({ periode: param.rentang, cari: param.cari, urut, halaman: param.halaman, perHalaman: param.per });
  return <LaporanKreatifClient param={{ ...param, urut, halaman: peringkat.halaman }} hariIni={hariIni} peringkat={peringkat} />;
}

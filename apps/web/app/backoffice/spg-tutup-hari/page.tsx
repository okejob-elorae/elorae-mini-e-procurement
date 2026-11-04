import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { hariSah, labelHariTutup } from "@/lib/spg/tutup-hari";
import { daftarTutupHariKantor, rekapTutupHariKantor } from "@/lib/spg/tutup-hari-queries";
import { TutupHariKantorClient } from "./TutupHariKantorClient";
import { kunciTokoHari, pengunjungRentang } from "./pengunjung";

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
    const [hitung, laporan] = await Promise.all([
      penghitungPerTokoHari(rekap.dari, rekap.sampai),
      prisma.spgDailyClose.findMany({
        where: { day: { gte: rekap.dari, lte: rekap.sampai } },
        select: { storeId: true, day: true, visitorCount: true },
      }),
    ]);
    const perLaporan = new Map(laporan.map((l) => [kunciTokoHari(l.storeId, l.day), l.visitorCount]));
    const pengunjung = Object.fromEntries(
      rekap.baris.map((b) => {
        const hari = new Set<string>();
        for (const k of [...hitung.keys(), ...perLaporan.keys()]) if (k.startsWith(`${b.storeId}|`)) hari.add(k);
        return [b.storeId, pengunjungRentang([...hari].map((k) => ({ penghitung: hitung.get(k) ?? null, laporan: perLaporan.get(k) ?? null })))];
      }),
    );
    return (
      <TutupHariKantorClient
        mode="rentang"
        hariIni={hariIni}
        rekap={rekap}
        pengunjung={pengunjung}
        label={`${labelHariTutup(rekap.dari)} – ${labelHariTutup(rekap.sampai)}`}
      />
    );
  }

  const day = hariSah(sp.hari) ? jepit(sp.hari) : hariIni;
  const [data, hitung] = await Promise.all([daftarTutupHariKantor(day), penghitungPerTokoHari(day, day)]);
  const penghitung = Object.fromEntries(data.baris.map((b) => [b.storeId, hitung.get(kunciTokoHari(b.storeId, day)) ?? null]));
  return <TutupHariKantorClient mode="hari" hariIni={hariIni} data={data} penghitung={penghitung} label={labelHariTutup(day)} />;
}

/** Penghitung pengunjung HP SPG, dijumlah per toko × hari (WIB). Hari tanpa baris = tidak ada yang menghitung. */
async function penghitungPerTokoHari(dari: string, sampai: string): Promise<Map<string, number>> {
  const rows = await prisma.spgVisitorCount.groupBy({
    by: ["storeId", "day"],
    where: { day: { gte: dari, lte: sampai } },
    _sum: { count: true },
  });
  return new Map(rows.map((r) => [kunciTokoHari(r.storeId, r.day), r._sum.count ?? 0]));
}

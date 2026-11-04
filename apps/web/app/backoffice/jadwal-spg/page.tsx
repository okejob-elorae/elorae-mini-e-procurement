import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaMinggu, geserHari, seninDari } from "@/lib/spg/shift";
import { daftarTukarKantor, jadwalSpgMingguKantor, jumlahTukarMenungguKantor, tokoDenganSpg } from "@/lib/spg/shift-queries";
import { statusJadwalBulanDari } from "@/lib/spg/jadwal-bulan";
import { antreanJadwalBulanKantor, jumlahJadwalBulanMenunggu } from "@/lib/spg/jadwal-bulan-queries";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { JadwalSpgClient, type LencanaBulan } from "./JadwalSpgClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ toko?: string | string[]; minggu?: string | string[]; tab?: string | string[] }>;
};

const pertama = (x: string | string[] | undefined) => (Array.isArray(x) ? x[0] : x);

/**
 * Jadwal & shift SPG — kantor menyusun jadwal kerja tiap SPG per toko per
 * minggu (Senin–Minggu WIB) dan memutuskan tukar shift yang sudah disetujui
 * rekannya. Melihat = `spg_sales:view`; mengubah dan memutuskan =
 * `stores:manage`. Hari yang sudah lewat hanya dibaca, beserta kenyataannya
 * (jam masuk, terlambat, tidak masuk, izin).
 *
 * Tab "Jadwal bulanan" (P7c): jadwal yang diisi SPG di HP, dasar gaji pokoknya. Menyetujui,
 * mengembalikan, dan membuka lagi = `spg_schedules:approve` — izin yang sama dengan aksinya
 * (`app/actions/spg-komisi-jadwal.ts`).
 */
export default async function JadwalSpgPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");
  const bolehUbah = hasPermission(izin, PERMISSIONS.STORES_MANAGE);
  const bolehSetujui = hasPermission(izin, PERMISSIONS.SPG_SCHEDULES_APPROVE);

  const sp = await searchParams;
  const tabDiminta = pertama(sp.tab);
  const tab = tabDiminta === "tukar" ? "tukar" : tabDiminta === "bulanan" ? "bulanan" : "jadwal";
  const sekarang = new Date();
  const hariIni = kunciHariWib(sekarang);
  const senin = bacaMinggu(pertama(sp.minggu), sekarang);

  const [toko, menungguKantor, bulananMenunggu] = await Promise.all([
    tokoDenganSpg(),
    jumlahTukarMenungguKantor(),
    jumlahJadwalBulanMenunggu(sekarang),
  ]);
  const diminta = pertama(sp.toko);
  const storeId = toko.find((t) => t.id === diminta)?.id ?? toko[0]?.id ?? null;
  const [data, tukar, bulanan] = await Promise.all([
    tab === "jadwal" && storeId ? jadwalSpgMingguKantor({ storeId, senin, sekarang }) : Promise.resolve(null),
    tab === "tukar" ? daftarTukarKantor() : Promise.resolve(null),
    tab === "bulanan" ? antreanJadwalBulanKantor({ sekarang }) : Promise.resolve(null),
  ]);

  // Lencana jadwal bulanan di kisi minggu: keadaan jadwal setiap SPG untuk bulan yang disentuh minggu ini.
  const lencanaBulan: Record<string, LencanaBulan[]> = {};
  if (data && data.orang.length > 0) {
    const bulanMinggu = [...new Set([data.hari[0], data.hari[data.hari.length - 1]].map((d) => d.slice(0, 7)))];
    const kepala = await prisma.spgMonthSchedule.findMany({
      where: { userId: { in: data.orang.map((o) => o.id) }, month: { in: bulanMinggu } },
      select: { userId: true, month: true, status: true },
      orderBy: { month: "asc" },
    });
    for (const k of kepala) {
      const status = statusJadwalBulanDari(k.status);
      if (!status) continue;
      (lencanaBulan[k.userId] ??= []).push({ bulan: k.month, label: salesMonthLabelId(k.month), status });
    }
  }

  return (
    <JadwalSpgClient
      tab={tab}
      toko={toko}
      storeId={storeId}
      senin={senin}
      hariIni={hariIni}
      mingguIni={seninDari(hariIni)}
      sebelum={geserHari(senin, -7)}
      sesudah={geserHari(senin, 7)}
      data={data}
      tukar={tukar}
      menungguKantor={menungguKantor}
      bolehUbah={bolehUbah}
      bulanan={bulanan}
      bulananMenunggu={bulananMenunggu}
      bolehSetujui={bolehSetujui}
      lencanaBulan={lencanaBulan}
    />
  );
}

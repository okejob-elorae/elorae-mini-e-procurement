import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaMinggu, geserHari, seninDari } from "@/lib/spg/shift";
import { daftarTukarKantor, jadwalSpgMingguKantor, jumlahTukarMenungguKantor, tokoDenganSpg } from "@/lib/spg/shift-queries";
import { JadwalSpgClient } from "./JadwalSpgClient";

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
 */
export default async function JadwalSpgPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");
  const bolehUbah = hasPermission(izin, PERMISSIONS.STORES_MANAGE);

  const sp = await searchParams;
  const tab = pertama(sp.tab) === "tukar" ? "tukar" : "jadwal";
  const sekarang = new Date();
  const hariIni = kunciHariWib(sekarang);
  const senin = bacaMinggu(pertama(sp.minggu), sekarang);

  const [toko, menungguKantor] = await Promise.all([tokoDenganSpg(), jumlahTukarMenungguKantor()]);
  const diminta = pertama(sp.toko);
  const storeId = toko.find((t) => t.id === diminta)?.id ?? toko[0]?.id ?? null;
  const [data, tukar] = await Promise.all([
    tab === "jadwal" && storeId ? jadwalSpgMingguKantor({ storeId, senin, sekarang }) : Promise.resolve(null),
    tab === "tukar" ? daftarTukarKantor() : Promise.resolve(null),
  ]);

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
    />
  );
}

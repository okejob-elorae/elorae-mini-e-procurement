import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { bacaMinggu, geserHari, seninDari } from "@/lib/salesman/jadwal";
import { daftarAreaToko, jadwalMinggu } from "@/lib/salesman/jadwal-queries";
import { daftarSalesman, tokoTerkunci } from "@/lib/salesman/queries";
import { JadwalKunjunganClient } from "./JadwalKunjunganClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ sales?: string | string[]; minggu?: string | string[] }>;
};

const pertama = (x: string | string[] | undefined) => (Array.isArray(x) ? x[0] : x);

/**
 * Jadwal Kunjungan — kantor menetapkan toko yang harus didatangi tiap sales
 * per hari, satu minggu (Senin–Minggu) sekali tampil. Melihat =
 * `field_sales_orders:view`; mengatur = `field_sales_orders:approve`. Hari
 * yang sudah lewat hanya bisa dibaca, dengan status kepatuhannya.
 */
export default async function JadwalKunjunganPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");
  const bolehAtur = hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);

  const sp = await searchParams;
  const sekarang = new Date();
  const hariIni = kunciHariWib(sekarang);
  const senin = bacaMinggu(pertama(sp.minggu), sekarang);

  const [sales, area, terkunci] = await Promise.all([daftarSalesman(), daftarAreaToko(), tokoTerkunci()]);
  const diminta = pertama(sp.sales);
  const salesmanId = sales.find((s) => s.id === diminta)?.id ?? sales[0]?.id ?? null;
  const minggu = salesmanId ? await jadwalMinggu(salesmanId, senin, sekarang) : null;

  return (
    <JadwalKunjunganClient
      sales={sales}
      salesmanId={salesmanId}
      senin={senin}
      hariIni={hariIni}
      mingguIni={seninDari(hariIni)}
      sebelum={geserHari(senin, -7)}
      sesudah={geserHari(senin, 7)}
      hari={minggu?.hari ?? []}
      ringkas={minggu?.ringkas ?? null}
      area={area}
      bolehAtur={bolehAtur}
      terkunci={terkunci}
    />
  );
}

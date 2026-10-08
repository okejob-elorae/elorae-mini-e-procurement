import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { bulanSah } from "@/lib/salesman/target-rinci";
import { kinerjaSpgKantor } from "@/lib/spg/kinerja-queries";
import { KinerjaSpgClient } from "./KinerjaSpgClient";
import { bacaTampilan } from "./tampilan";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bulan?: string; toko?: string; tampilan?: string }> };

/**
 * Kinerja SPG — kantor. Satu bulan WIB (`?bulan=YYYY-MM`, bawaan bulan ini;
 * bulan depan dijepit ke bulan ini) dan opsional satu toko (`?toko=`). Satu
 * baris per SPG × toko: kehadiran menurut jadwal, penjualan bersih, pengunjung
 * dan konversi, capaian target, kepatuhan tutup hari, titip pesan, retur.
 * `?tampilan=kehadiran` membuka tab Kehadiran & layanan (bawaan Penjualan).
 */
export default async function KinerjaSpgPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const bulanIni = bulanWib(sekarang);
  const bulan = bulanSah(sp.bulan) && sp.bulan <= bulanIni ? sp.bulan : bulanIni;
  const toko = typeof sp.toko === "string" && sp.toko.length > 0 && sp.toko.length <= 64 ? sp.toko : null;

  const data = await kinerjaSpgKantor({ bulan, storeId: toko, sekarang });
  return <KinerjaSpgClient data={data} tampilanAwal={bacaTampilan(sp.tampilan)} />;
}

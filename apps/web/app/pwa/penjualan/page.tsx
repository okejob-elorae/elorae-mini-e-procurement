import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { riwayatPenjualan } from "@/lib/salesman/riwayat-penjualan-queries";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { PenjualanClient, type DataPenjualan } from "./PenjualanClient";

export const dynamic = "force-dynamic";

/**
 * Riwayat penjualan salesman — bulan-bulan sebelumnya, bukan hanya bulan ini.
 *
 * Hanya milik salesman yang login. Angkanya memakai `penjualanSalesman`, sumber
 * kartu "Bulan ini" di beranda, jadi bulan berjalan di sini sama persis dengan
 * beranda. Konsinyasi tampil sebagai jumlah per bulan (seperti kartu beranda)
 * dan sebagai pcs per toko/barang — tidak pernah sebagai rupiah per toko atau
 * per barang. SPG punya berandanya sendiri, jadi dikembalikan ke sana.
 */
export default async function PenjualanPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const hariIni = new Date();
  const { bulan } = await searchParams;
  const r = await riwayatPenjualan(session.user.id, bulan, hariIni);

  const data: DataPenjualan = {
    daftarBulan: r.daftarBulan,
    bulan: r.bulan,
    bulanIni: bulanWib(hariIni),
    seri: r.seri,
    ringkas: r.ringkas,
    target: r.target,
    toko: r.toko,
    barang: r.barang,
  };
  return <PenjualanClient data={data} />;
}

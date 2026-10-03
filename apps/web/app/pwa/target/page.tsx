import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { kemajuanTarget } from "@/lib/salesman/dasbor";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { pengaturanSalesman } from "@/lib/salesman/queries";
import { targetSaya } from "@/lib/salesman/target-rinci-queries";
import { TargetSayaClient, type DataTargetSaya } from "./TargetSayaClient";

export const dynamic = "force-dynamic";

/**
 * Target saya — target per kategori dan per barang yang ditetapkan kantor
 * untuk bulan ini, dengan kemajuan, "kurang berapa lagi", dan lajunya.
 *
 * Hanya milik salesman yang login. Capaiannya memakai definisi omzet yang sama
 * dengan kartu "Bulan ini" di beranda (putus terkirim + konsi disetujui + van),
 * jadi target total di atas halaman ini selalu sama angkanya dengan beranda.
 * Konsinyasi hanya ikut sebagai jumlah per kategori/barang — persis seperti
 * kartu beranda menampilkan jumlah konsinyasi; harga per barisnya tidak pernah
 * dikirim ke HP.
 *
 * SPG (toko tetap): capaiannya dari nota penjualannya sendiri bulan ini, bersih
 * dari retur pembeli (`capaianRinciSpg`); target totalnya dari pengaturan yang
 * sama dengan sales (`salesman.targets`, target per orang).
 */
export default async function TargetSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const salesmanId = session.user.id;
  const spg = Boolean(await ambilTokoTetap(salesmanId));
  const hariIni = new Date();
  const bulan = bulanWib(hariIni);
  const [rinci, atur] = await Promise.all([
    targetSaya(salesmanId, bulan, hariIni, { spg }),
    pengaturanSalesman(salesmanId, hariIni),
  ]);

  const urut = [...rinci.baris].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "KATEGORI" ? -1 : 1));
  const data: DataTargetSaya = {
    bulan,
    spg,
    total: { omzet: rinci.capaian.total, kemajuan: kemajuanTarget(atur.target, rinci.capaian.total, hariIni) },
    baris: urut.map((b) => ({
      kunci: `${b.scope}:${b.refId}`,
      scope: b.scope,
      nama: b.nama,
      sku: b.sku,
      measure: b.measure,
      tanpaKonsi: b.tanpaKonsi,
      target: b.kemajuan.target,
      capai: b.kemajuan.capai,
      persen: b.kemajuan.persen,
      kurang: b.kemajuan.kurang,
      laju: b.kemajuan.laju,
      perHari: b.kemajuan.perHari,
      sisaHari: b.kemajuan.sisaHari,
    })),
  };
  return <TargetSayaClient data={data} />;
}

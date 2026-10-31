import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { kemajuanTarget } from "@/lib/salesman/dasbor";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { pengaturanSalesman } from "@/lib/salesman/queries";
import { targetSayaHp } from "@/lib/salesman/target-rinci-queries";
import { TargetSayaClient, type DataTargetSaya } from "./TargetSayaClient";

export const dynamic = "force-dynamic";

/**
 * Target saya — target per kategori dan per barang yang ditetapkan kantor
 * untuk bulan ini, dengan kemajuan, "kurang berapa lagi", dan lajunya.
 *
 * Hanya milik salesman yang login. Aturan mutlak pemilik: harga dan total
 * konsinyasi tidak pernah sampai ke HP. Payload-nya dari `targetSayaHp`:
 * target total memakai omzet putus + van — angka yang sama dengan kartu
 * "Bulan ini" di beranda — dan setiap target dalam rupiah (kategori maupun
 * barang) dihitung tanpa konsinyasi; target pcs tetap menghitung pcs konsi.
 * Capaian × target − putus − van akan membuka total konsi, jadi capaian yang
 * memuat konsi tidak pernah dikirim.
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
  const [hp, atur] = await Promise.all([
    targetSayaHp(salesmanId, bulan, hariIni, { spg }),
    pengaturanSalesman(salesmanId, hariIni),
  ]);

  const data: DataTargetSaya = {
    bulan,
    spg,
    total: { omzet: hp.omzet, kemajuan: kemajuanTarget(atur.target, hp.omzet, hariIni) },
    baris: hp.baris,
  };
  return <TargetSayaClient data={data} />;
}

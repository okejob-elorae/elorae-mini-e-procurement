import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { daftarSalesman, daftarSpg } from "@/lib/salesman/queries";
import { bulanBerikutnya, bulanSah, bulanSebelumnya, capaianUntuk, type BarisTarget } from "@/lib/salesman/target-rinci";
import {
  capaianRinciOrang,
  namaAcuanTarget,
  namaKategori,
  pilihanAcuanTarget,
  targetRinciBulan,
} from "@/lib/salesman/target-rinci-queries";
import { TargetSalesClient, type DataTargetSales } from "./TargetSalesClient";

export const dynamic = "force-dynamic";

/** Bulan yang ditawarkan: enam bulan ke belakang sampai dua bulan ke depan. */
const MUNDUR = 6;
const MAJU = 2;

function daftarBulan(sekarang: string, dipilih: string): string[] {
  const hasil: string[] = [];
  let b = sekarang;
  for (let i = 0; i < MAJU; i++) b = bulanBerikutnya(b);
  for (let i = 0; i < MUNDUR + MAJU + 1; i++) {
    hasil.push(b);
    b = bulanSebelumnya(b);
  }
  // Bulan dari alamat yang di luar jangkauan tetap bisa dibuka (tautan lama).
  if (!hasil.includes(dipilih)) hasil.push(dipilih);
  return hasil.sort().reverse();
}

type PageProps = { searchParams: Promise<{ bulan?: string | string[]; salesman?: string | string[] }> };

const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Target sales per kategori dan per barang — di samping target total bulanan
 * (Pengaturan → Salesman), yang tetap di tempatnya. Kantor menetapkan per sales
 * per bulan; capaiannya dihitung dengan definisi omzet beranda HP salesman.
 * SPG ikut dipilih (target per orang): capaiannya dari nota penjualannya sendiri,
 * bersih dari retur pembeli (`capaianRinciSpg`).
 *
 * Melihat = `field_sales_orders:view`; mengubah = `field_sales_orders:approve`.
 */
export default async function TargetSalesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice/dashboard");
  const bolehUbah = hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);

  const sp = await searchParams;
  const hariIni = new Date();
  const bulanBerjalan = bulanWib(hariIni);
  const mintaBulan = satu(sp.bulan);
  const bulan = bulanSah(mintaBulan) ? mintaBulan : bulanBerjalan;

  const [sales, spg] = await Promise.all([daftarSalesman(), daftarSpg()]);
  const salesman = [
    ...sales.map((s) => ({ id: s.id, nama: s.nama, spg: false, toko: null })),
    ...spg.map((s) => ({ id: s.id, nama: s.nama, spg: true, toko: s.tokoNama })),
  ];
  const mintaSales = satu(sp.salesman);
  const dipilih = salesman.find((s) => s.id === mintaSales)?.id ?? null;
  const ids = salesman.map((s) => s.id);

  const [target, capaian, targetLalu, pilihan] = await Promise.all([
    targetRinciBulan(bulan, ids),
    capaianRinciOrang({ salesmanIds: sales.map((s) => s.id), spgIds: spg.map((s) => s.id) }, bulan, hariIni),
    dipilih ? targetRinciBulan(bulanSebelumnya(bulan), [dipilih]) : Promise.resolve(new Map<string, BarisTarget[]>()),
    dipilih && bolehUbah ? pilihanAcuanTarget() : Promise.resolve(null),
  ]);
  const semuaTarget = [...target.values()].flat();
  const nama = await namaAcuanTarget(semuaTarget);

  // Ringkasan: kolom = kategori yang punya target pada sales mana pun bulan ini.
  const kolom = [...new Set(semuaTarget.filter((t) => t.scope === "KATEGORI").map((t) => t.refId))]
    .map((id) => ({ id, nama: nama.get(`KATEGORI:${id}`)?.nama ?? "—" }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  const ringkasan: DataTargetSales["ringkasan"] = {
    kategori: kolom,
    baris: salesman.map((s) => {
      const milik = target.get(s.id) ?? [];
      const c = capaian.get(s.id)!;
      const barang = milik.filter((t) => t.scope === "BARANG");
      return {
        id: s.id,
        nama: s.nama,
        spg: s.spg,
        toko: s.toko,
        jumlahTarget: milik.length,
        omzet: c.total,
        sel: Object.fromEntries(
          milik
            .filter((t) => t.scope === "KATEGORI")
            .map((t) => [t.refId, { measure: t.measure, target: t.value, capai: capaianUntuk(c, t) }]),
        ),
        barang: { jumlah: barang.length, tercapai: barang.filter((t) => capaianUntuk(c, t) >= t.value).length },
      };
    }),
  };

  let rinci: DataTargetSales["rinci"] = null;
  if (dipilih) {
    const c = capaian.get(dipilih)!;
    const milik = target.get(dipilih) ?? [];
    const namaKat = await namaKategori(Object.keys(c.kategori));
    rinci = {
      baris: milik.map((t) => {
        const n = nama.get(`${t.scope}:${t.refId}`);
        return { ...t, nama: n?.nama ?? "—", sku: n?.sku ?? null, aktif: n?.aktif ?? false };
      }),
      capaian: { kategori: c.kategori, barang: c.barang, total: c.total },
      penjualanKategori: Object.entries(c.kategori)
        .map(([id, x]) => ({ id, nama: namaKat.get(id) ?? null, nilai: x.nilai, pcs: x.pcs }))
        .sort((a, b) => b.nilai - a.nilai),
      jumlahBulanLalu: targetLalu.get(dipilih)?.length ?? 0,
    };
  }

  return (
    <TargetSalesClient
      data={{
        bulan,
        pilihanBulan: daftarBulan(bulanBerjalan, bulan),
        bulanBerjalan,
        hariIni: hariIni.toISOString(),
        salesman,
        dipilih,
        bolehUbah,
        ringkasan,
        rinci,
        pilihan,
      }}
    />
  );
}

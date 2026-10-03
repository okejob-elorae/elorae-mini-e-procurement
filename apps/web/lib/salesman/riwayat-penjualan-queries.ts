import { prisma } from "@elorae/db";
import { bacaTargetBulan, KUNCI_TARGET } from "./pengaturan";
import { penjualanSalesman } from "./queries";
import {
  awalBulanWib,
  barangTeratas,
  bulanAwalBacaan,
  capaianTarget,
  daftarBulan,
  pilihBulan,
  ringkasBulan,
  susunSeriBulanan,
  tokoTeratas,
  type CapaianTarget,
  type JualKeToko,
  type RingkasanBulan,
  type TitikBulan,
} from "./riwayat-penjualan";
import { rentangBulanWib } from "./target-rinci";
import { capaianRinciSales } from "./target-rinci-queries";

/**
 * Kueri halaman "Riwayat penjualan" di HP salesman. Aturannya di
 * `riwayat-penjualan.ts`.
 *
 * Angka bulanan (total, kanal, grafik, pembanding) memakai `penjualanSalesman`
 * SENDIRI — bukan salinannya — jadi bulan ini di halaman ini selalu sama dengan
 * kartu "Bulan ini" di beranda. Barang teratas memakai `capaianRinciSales`
 * (sumber yang sama, dipasak tesnya sama dengan beranda); toko teratas
 * membaca dokumen yang sama dengan aturan tanggal yang sama (`rentangBulanWib`).
 * Semuanya disaring ke satu salesman: layar HP tidak pernah menampilkan angka
 * salesman lain.
 */

const angka = (v: unknown) => Number(v ?? 0);

export type TokoTeratasBaris = { storeId: string; nama: string; pcs: number; pcsKonsi: number; nilaiTanpaKonsi: number };
export type BarangTeratasBaris = { itemId: string; nama: string; sku: string; pcs: number; pcsKonsi: number; nilaiTanpaKonsi: number };

export type RiwayatPenjualan = {
  daftarBulan: string[];
  bulan: string;
  seri: TitikBulan[];
  ringkas: RingkasanBulan;
  target: CapaianTarget | null;
  toko: TokoTeratasBaris[];
  barang: BarangTeratasBaris[];
};

/** Dokumen penjualan salesman sebulan, per toko — bahan "Toko teratas". */
export async function jualKeTokoSebulan(salesmanId: string, bulan: string, hariIni: Date): Promise<JualKeToko[]> {
  const rentang = rentangBulanWib(bulan, hariIni);
  if (!rentang) return [];
  const waktu = { gte: rentang.awal, lt: rentang.akhir };
  const [kirim, konsi, van] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: waktu, order: { salesmanId, orderType: "PUTUS" } },
      select: { total: true, order: { select: { storeId: true } }, lines: { select: { qty: true, orderLine: { select: { isBonus: true } } } } },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { salesmanId, orderType: "KONSI", status: "APPROVED", approvedAt: waktu },
      select: { storeId: true, lines: { select: { qty: true, isBonus: true } } },
    }),
    prisma.vanSale.findMany({
      where: { salesmanId, createdAt: waktu },
      select: { storeId: true, total: true, lines: { select: { qty: true } } },
    }),
  ]);
  // Baris bonus (promo "beli X gratis Y") tidak dihitung pcs-nya — aturan target rinci.
  return [
    ...kirim.map((d) => ({
      storeId: d.order.storeId,
      jenis: "putus" as const,
      nilai: angka(d.total),
      pcs: d.lines.reduce((n, l) => n + (l.orderLine.isBonus ? 0 : l.qty), 0),
    })),
    // Nilai konsi sengaja 0: tidak pernah ditampilkan per toko di HP.
    ...konsi.map((o) => ({
      storeId: o.storeId,
      jenis: "konsi" as const,
      nilai: 0,
      pcs: o.lines.reduce((n, l) => n + (l.isBonus ? 0 : l.qty), 0),
    })),
    ...van.map((v) => ({
      storeId: v.storeId,
      jenis: "van" as const,
      nilai: angka(v.total),
      pcs: v.lines.reduce((n, l) => n + angka(l.qty), 0),
    })),
  ];
}

export async function riwayatPenjualan(salesmanId: string, bulanParam: unknown, hariIni: Date): Promise<RiwayatPenjualan> {
  const bulanList = daftarBulan(hariIni);
  const bulan = pilihBulan(bulanParam, bulanList);

  const [baris, setelanTarget, perToko, rinci] = await Promise.all([
    penjualanSalesman(salesmanId, awalBulanWib(bulanAwalBacaan(bulanList))),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { value: true } }),
    jualKeTokoSebulan(salesmanId, bulan, hariIni),
    capaianRinciSales([salesmanId], bulan, hariIni),
  ]);

  const ringkas = ringkasBulan(baris, bulan, hariIni);
  const capaian = rinci.get(salesmanId);
  const teratasToko = tokoTeratas(perToko);
  const teratasBarang = capaian ? barangTeratas(capaian.barang, capaian.barangKonsi) : [];

  const [toko, barang] = await Promise.all([
    teratasToko.length
      ? prisma.store.findMany({ where: { id: { in: teratasToko.map((t) => t.storeId) } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    teratasBarang.length
      ? prisma.item.findMany({ where: { id: { in: teratasBarang.map((b) => b.itemId) } }, select: { id: true, sku: true, nameId: true } })
      : Promise.resolve([]),
  ]);
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  const infoBarang = new Map(barang.map((b) => [b.id, b]));

  return {
    daftarBulan: bulanList,
    bulan,
    seri: susunSeriBulanan(baris, bulanList, hariIni),
    ringkas,
    target: capaianTarget(bacaTargetBulan(setelanTarget?.value, salesmanId, bulan), ringkas.jumlah.total),
    toko: teratasToko.map((t) => ({ ...t, nama: namaToko.get(t.storeId) ?? "—" })),
    barang: teratasBarang.map((b) => ({
      ...b,
      nama: infoBarang.get(b.itemId)?.nameId ?? "—",
      sku: infoBarang.get(b.itemId)?.sku ?? "",
    })),
  };
}

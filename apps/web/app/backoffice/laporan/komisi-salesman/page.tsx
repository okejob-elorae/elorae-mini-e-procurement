import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaBulan, daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { laporanKomisiBulan } from "@/lib/salesman/komisi-queries";
import { bolehMengelola } from "@/lib/receivables/izin";
import { potonganHilangSalesBulan } from "@/lib/spg/hilang-queries";
import { KomisiSalesmanClient } from "./KomisiSalesmanClient";

export const dynamic = "force-dynamic";

/** Bulan yang bisa dipilih di laporan: satu tahun ke belakang. */
const JUMLAH_BULAN = 12;

/**
 * Laporan → Komisi salesman: perkiraan komisi setiap salesman untuk satu bulan
 * WIB, dari skema di Pengaturan → Salesman. Angka yang sama persis dengan yang
 * dilihat salesman di HP-nya (`komisi-queries.ts` dipakai keduanya).
 *
 * Dijaga `field_sales_orders:approve` — penyetuju pesanan salesman adalah yang
 * menetapkan target dan skema komisinya, dan komisi per orang adalah angka
 * gaji, lebih sensitif dari capaian yang boleh dilihat pemegang
 * `field_sales_orders:view`. Tidak ada izin baru, tidak ada yang perlu di-seed.
 */
export default async function LaporanKomisiSalesmanPage({
  searchParams,
}: {
  searchParams: Promise<{ bulan?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    redirect("/backoffice/dashboard");
  }

  const pilihan = daftarBulanTerakhir(new Date(), JUMLAH_BULAN);
  const bulan = bacaBulan((await searchParams).bulan, pilihan);
  const { skema, baris } = await laporanKomisiBulan(bulan);
  // Beban barang hilang bagian SALES: sisa, yang sudah ditandai dipotong bulan
  // ini, dan saran potongan (batas persen di Pengaturan → SPG × komisi).
  const potongan = await potonganHilangSalesBulan(
    baris.map((b) => ({ salesmanId: b.salesmanId, komisi: b.hasil.komisi })),
    bulan,
  );

  return (
    <KomisiSalesmanClient
      bulan={bulan}
      pilihan={pilihan}
      skema={{
        aktif: skema.aktif,
        dasar: skema.dasar,
        tarifPersen: skema.tarifPersen,
        jumlahTingkat: skema.tingkat.length,
        bagianPenagihPersen: skema.bagianPenagihPersen,
      }}
      baris={baris.map((b) => ({
        salesmanId: b.salesmanId,
        nama: b.nama,
        omzet: b.omzet,
        target: b.target,
        capaianPersen: b.hasil.capaianPersen,
        dasarNilai: b.hasil.dasarNilai,
        bagianPenjual: b.tertagih.bagianPenjual,
        bagianPenagih: b.tertagih.bagianPenagih,
        tarifDasar: b.hasil.tarifDasar,
        tarifDipakai: b.hasil.tarifDipakai,
        komisi: b.hasil.komisi,
      }))}
      potonganHilang={potongan.per}
      maksPotongPersen={potongan.maksPotongPersen}
      bolehPotong={bolehMengelola(session.user.permissions)}
    />
  );
}

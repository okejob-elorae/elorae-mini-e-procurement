import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { alamatPelunasanKinerja, alamatPesananKinerja } from "@/lib/field-sales/saringan-kinerja";
import { bolehMembacaPelunasan } from "@/lib/receivables/izin";
import { bacaRentang } from "@/lib/salesman/metrik-lapangan";
import { kinerjaSemuaSales } from "@/lib/salesman/metrik-queries";
import { keAngka, labelRentang, paramRentang } from "./bentuk";
import { KinerjaSalesClient } from "./KinerjaSalesClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ rentang?: string | string[]; dari?: string | string[]; sampai?: string | string[] }>;
};

/**
 * Kinerja Sales Lapangan — dasbor atasan: satu baris per sales untuk rentang
 * yang dipilih (bawaan hari ini), baris total, alasan kunjungan tanpa
 * transaksi, dan ekspor Excel. Angkanya dihitung dengan aturan yang sama
 * dengan layar "Hari ini" di HP sales dan kabar ringkasan harian.
 */
export default async function KinerjaSalesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const { preset, rentang } = bacaRentang(sp, sekarang);
  const tim = await kinerjaSemuaSales(rentang, { sekarang });
  const q = paramRentang(preset, rentang);
  const bolehPelunasan = bolehMembacaPelunasan(session.user.permissions);

  return (
    <KinerjaSalesClient
      filter={{ preset, dari: rentang.dari, sampai: rentang.sampai, label: labelRentang(rentang) }}
      baris={tim.baris.map((b) => ({
        salesmanId: b.salesmanId,
        nama: b.nama,
        href: `/backoffice/sales-lapangan/${encodeURIComponent(b.salesmanId)}?${q}`,
        // Daftar tujuan disaring sama dengan angkanya: rentang, sales, menunggu + disetujui.
        pesananHref: alamatPesananKinerja(rentang, b.salesmanId),
        pelunasanHref: bolehPelunasan ? alamatPelunasanKinerja(rentang, b.nama) : undefined,
        angka: keAngka(b.metrik, b),
      }))}
      total={keAngka(tim.total)}
      hasil={tim.total.hasil.perKode}
      perTanda={tim.total.perTanda}
      tautan={{
        pesanan: alamatPesananKinerja(rentang),
        // BKM terverifikasi yang diverifikasi dalam rentang — sama dengan angka kartunya.
        pelunasan: bolehPelunasan ? alamatPelunasanKinerja(rentang) : undefined,
      }}
    />
  );
}

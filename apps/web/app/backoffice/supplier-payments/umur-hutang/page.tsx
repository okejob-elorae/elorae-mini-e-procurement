import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { tanggalKalenderSah } from "@/lib/finance/kas/aturan";
import { umurHutangPemasok, type LaporanUmurHutang } from "@/lib/purchasing/pembayaran-queries";
import { UmurHutangClient } from "./UmurHutangClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Umur hutang pemasok: sisa hutang per pemasok dikelompokkan 0–30, 31–60,
 * 61–90, > 90 hari dari tanggal dokumen (GRN, penerimaan barang jadi untuk
 * jasa, saldo awal), uang muka/lebih bayar sebagai kredit, dan pembanding
 * saldo hutang usaha di buku besar. `?tanggal=` menggeser tanggal umur (saldo
 * tetap saldo saat ini). Melihat `supplier_payments:view` atau `journals:view`.
 */
export default async function UmurHutangPage({ searchParams }: { searchParams: Promise<{ tanggal?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW) && !hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const sp = await searchParams;
  const hariIni = hariIniWib();
  const tanggal = tanggalKalenderSah(satu(sp.tanggal)) ? satu(sp.tanggal) : hariIni;
  let laporan: LaporanUmurHutang | null = null;
  try {
    laporan = await umurHutangPemasok(tanggal);
  } catch (e) {
    console.error("[umur-hutang] gagal", e);
  }
  return <UmurHutangClient laporan={laporan} tanggal={tanggal} hariIni={hariIni} bolehBayar={hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)} />;
}

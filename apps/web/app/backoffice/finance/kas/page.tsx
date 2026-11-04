import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaJenisVoucher, tanggalKalenderSah } from "@/lib/finance/kas/aturan";
import { daftarVoucher, type HalamanVoucher } from "@/lib/finance/kas/voucher-queries";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { KasClient, type SaringanKas } from "./KasClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Keuangan → Kas & bank: voucher kas/bank keluar (BKK), masuk (BKMK), dan
 * transfer antar rekening. Saringan, ringkasan, dan halaman dihitung di server
 * dan tersimpan di alamat. Melihat `journals:view`; mencatat & membatalkan
 * `journals:manage`.
 */
export default async function KasPage({ searchParams }: { searchParams: Promise<{ jenis?: Param; rekening?: Param; status?: Param; dari?: Param; sampai?: Param; cari?: Param; halaman?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const sp = await searchParams;
  const status = satu(sp.status);
  const saringan: SaringanKas = {
    jenis: bacaJenisVoucher(satu(sp.jenis)) ?? "",
    rekening: satu(sp.rekening).slice(0, 64),
    status: status === "POSTED" || status === "CANCELLED" ? status : "",
    dari: tanggalKalenderSah(satu(sp.dari)) ? satu(sp.dari) : "",
    sampai: tanggalKalenderSah(satu(sp.sampai)) ? satu(sp.sampai) : "",
    cari: satu(sp.cari).trim().slice(0, 100),
    halaman: Math.max(1, Number.parseInt(satu(sp.halaman), 10) || 1),
  };
  let data: HalamanVoucher | null = null;
  try {
    data = await daftarVoucher({
      jenis: saringan.jenis || null,
      rekeningId: saringan.rekening || null,
      status: saringan.status || null,
      dari: saringan.dari || null,
      sampai: saringan.sampai || null,
      cari: saringan.cari || null,
      halaman: saringan.halaman,
    });
  } catch (e) {
    console.error("[kas] gagal memuat", e);
  }
  const rekening = await rekeningKasBank();
  return <KasClient key={JSON.stringify(saringan)} saringan={saringan} data={data} rekening={rekening} bolehKelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { keadaanKasKecil, bacaPengaturanKasKecilDb } from "@/lib/finance/kas/kas-kecil-writer";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { KasKecilClient } from "./KasKecilClient";

export const dynamic = "force-dynamic";

/**
 * Kas kecil (dana tetap): saldo buku tiap dana, pengeluaran sejak isi ulang
 * terakhir, dan "Isi ulang" (satu voucher transfer sebesar dana tetap − saldo).
 * Melihat `journals:view`; mengatur dan mengisi ulang `journals:manage`.
 */
export default async function KasKecilPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const [dana, pengaturan, rekening] = await Promise.all([keadaanKasKecil(), bacaPengaturanKasKecilDb(), rekeningKasBank()]);
  return <KasKecilClient dana={dana} pengaturan={pengaturan} rekening={rekening} bolehKelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}

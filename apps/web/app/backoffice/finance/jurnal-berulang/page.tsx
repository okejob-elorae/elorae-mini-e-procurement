import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarTemplat, type BarisTemplat } from "@/lib/finance/berulang/queries";
import { DaftarTemplatClient } from "./DaftarTemplatClient";

export const dynamic = "force-dynamic";

/**
 * Keuangan → Jurnal berulang: templat jurnal bulanan (sewa, gaji, langganan,
 * akrual) dengan keadaan persetujuannya. Melihat `journals:view`; membuat,
 * menyetujui, dan memposting `journals:manage`.
 */
export default async function JurnalBerulangPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  let baris: BarisTemplat[] = [];
  let gagal = false;
  try {
    baris = await daftarTemplat();
  } catch (e) {
    console.error("[jurnal-berulang] gagal memuat", e);
    gagal = true;
  }
  return <DaftarTemplatClient baris={baris} bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} penggunaId={session.user.id} gagal={gagal} />;
}

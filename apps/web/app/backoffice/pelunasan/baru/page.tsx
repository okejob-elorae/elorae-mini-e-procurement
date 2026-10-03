import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bahanKlaimBaru, bahanSalinKlaim } from "@/lib/receivables/claim-queries";
import { KlaimBaruClient } from "./KlaimBaruClient";

export const dynamic = "force-dynamic";

export default async function KlaimBaruPage({ searchParams }: { searchParams: Promise<{ salin?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    redirect("/backoffice/pelunasan");
  }

  // "Buat ulang" dari BKM yang ditolak/dibatalkan: tanggal, cara bayar, giro, foto ikut.
  const { salin } = await searchParams;
  const awal = salin ? await bahanSalinKlaim(salin) : null;
  return <KlaimBaruClient bahan={await bahanKlaimBaru()} awal={awal} />;
}

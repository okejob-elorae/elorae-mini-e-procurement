import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bahanKlaimBaru, bahanSalinKlaim } from "@/lib/receivables/claim-queries";
import { KlaimBaruClient } from "./KlaimBaruClient";

export const dynamic = "force-dynamic";

export default async function KlaimBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ salin?: string; toko?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    redirect("/backoffice/pelunasan");
  }

  // "Buat ulang" dari BKM yang ditolak/dibatalkan: tanggal, cara bayar, giro, foto ikut.
  // `?toko=` (dari kartu Tagihan siklus konsinyasi): toko itu langsung terpilih,
  // hanya kalau memang ada di pemilih formulir ini.
  const { salin, toko } = await searchParams;
  const [awal, bahan] = await Promise.all([salin ? bahanSalinKlaim(salin) : null, bahanKlaimBaru()]);
  const tokoAwal = typeof toko === "string" && bahan.toko.some((t) => t.id === toko) ? toko : null;
  return <KlaimBaruClient bahan={bahan} awal={awal} tokoAwal={tokoAwal} />;
}

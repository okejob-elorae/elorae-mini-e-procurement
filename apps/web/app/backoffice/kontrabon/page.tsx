import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKontrabon, piutangSiapKontrabon } from "@/lib/receivables/collection-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { KontrabonClient } from "./KontrabonClient";

export const dynamic = "force-dynamic";

export default async function KontrabonPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");

  const [baris, kandidat] = await Promise.all([daftarKontrabon(), piutangSiapKontrabon()]);

  return (
    <KontrabonClient
      baris={baris}
      kandidat={kandidat}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

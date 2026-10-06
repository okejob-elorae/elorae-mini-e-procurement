import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKontrabon, piutangSiapKontrabon } from "@/lib/receivables/collection-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { KontrabonClient } from "./KontrabonClient";

export const dynamic = "force-dynamic";

/** `?saring=belum` (tautan Beranda) membuka saringan "Belum dikonfirmasi". */
export default async function KontrabonPage(props?: { searchParams: Promise<{ saring?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");

  const [baris, kandidat] = await Promise.all([daftarKontrabon(), piutangSiapKontrabon()]);
  const saringAwal = (await props?.searchParams)?.saring === "belum" ? "belum" : "semua";

  return (
    <KontrabonClient
      // Dipasang ulang saat `?saring=` berubah — saringan awal hanya dibaca sekali.
      key={saringAwal}
      baris={baris}
      saringAwal={saringAwal}
      kandidat={kandidat}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

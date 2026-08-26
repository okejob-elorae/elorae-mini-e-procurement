import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKontrabon, piutangSiapKontrabon } from "@/lib/receivables/collection-queries";
import { KontrabonClient } from "./KontrabonClient";

export const dynamic = "force-dynamic";

export default async function KontrabonPage() {
  const session = await auth();
  if (!session) redirect("/login");

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

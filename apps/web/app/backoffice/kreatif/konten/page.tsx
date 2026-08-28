import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKonten, ringkasKreatif } from "@/lib/creative/queries";
import { daftarBrief } from "@/lib/creative/queries";
import { KontenClient } from "./KontenClient";

export const dynamic = "force-dynamic";

export default async function KontenPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  const [baris, ringkas, brief] = await Promise.all([
    daftarKonten(),
    ringkasKreatif(),
    daftarBrief(),
  ]);
  return (
    <KontenClient
      baris={baris}
      ringkas={ringkas}
      brief={brief.map((b) => ({ id: b.id, label: `${b.docNo} · ${b.campaign}` }))}
      bolehMengelola={kelola}
    />
  );
}

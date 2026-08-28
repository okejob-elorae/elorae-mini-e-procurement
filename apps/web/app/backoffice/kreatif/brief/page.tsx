import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBrief, daftarKol } from "@/lib/creative/queries";
import { katalogBarang } from "@/lib/receivables/return-queries";
import { BriefClient } from "./BriefClient";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  const [baris, kol, katalog] = await Promise.all([
    daftarBrief(),
    daftarKol({ hanyaAktif: true }),
    kelola ? katalogBarang() : Promise.resolve([]),
  ]);
  return (
    <BriefClient
      baris={baris}
      kol={kol.map((k) => ({ id: k.id, name: k.name }))}
      katalog={katalog}
      bolehMengelola={kelola}
    />
  );
}

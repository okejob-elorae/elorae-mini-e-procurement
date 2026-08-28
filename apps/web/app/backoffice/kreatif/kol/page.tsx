import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKol } from "@/lib/creative/queries";
import { KolClient } from "./KolClient";

export const dynamic = "force-dynamic";

export default async function KolPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  return <KolClient baris={await daftarKol()} bolehMengelola={kelola} />;
}

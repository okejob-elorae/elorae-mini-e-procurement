import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarRetur, ringkasRetur, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { ReturTokoClient } from "./ReturTokoClient";

export const dynamic = "force-dynamic";

export default async function ReturTokoPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [baris, toko] = await Promise.all([daftarRetur(), tokoUntukRetur()]);
  const izin = session.user.permissions ?? [];

  return (
    <ReturTokoClient
      baris={baris}
      ringkasan={ringkasRetur(baris)}
      toko={toko}
      bolehMengelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}
      bolehMenghitung={hasPermission(izin, PERMISSIONS.INVENTORY_OPNAME_COUNT)}
    />
  );
}

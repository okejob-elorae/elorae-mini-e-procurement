import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarImpor } from "@/lib/receivables/impor/batal";
import { ImporClient } from "./ImporClient";
import { RiwayatImpor } from "./RiwayatImpor";

export const dynamic = "force-dynamic";

export default async function ImporPiutangPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    redirect("/backoffice/piutang");
  }
  return (
    <div className="space-y-6">
      <ImporClient />
      <RiwayatImpor batch={await daftarImpor()} />
    </div>
  );
}

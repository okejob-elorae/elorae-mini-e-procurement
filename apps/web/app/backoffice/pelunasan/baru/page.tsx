import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bahanKlaimBaru } from "@/lib/receivables/claim-queries";
import { KlaimBaruClient } from "./KlaimBaruClient";

export const dynamic = "force-dynamic";

export default async function KlaimBaruPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    redirect("/backoffice/pelunasan");
  }

  return <KlaimBaruClient bahan={await bahanKlaimBaru()} />;
}

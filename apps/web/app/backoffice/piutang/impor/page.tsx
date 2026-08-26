import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ImporClient } from "./ImporClient";

export const dynamic = "force-dynamic";

export default async function ImporPiutangPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    redirect("/backoffice/piutang");
  }
  return <ImporClient />;
}

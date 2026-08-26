import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBeban } from "@/lib/receivables/dashboard-queries";
import { BebanClient } from "./BebanClient";

export const dynamic = "force-dynamic";

export default async function BebanSelisihPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <BebanClient
      baris={await daftarBeban()}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

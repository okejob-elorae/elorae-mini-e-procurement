import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPiutang, ringkasPiutang } from "@/lib/receivables/queries";
import { PiutangClient } from "./PiutangClient";

export const dynamic = "force-dynamic";

export default async function PiutangPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const baris = await daftarPiutang();
  return (
    <PiutangClient
      baris={baris}
      ringkasan={ringkasPiutang(baris)}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

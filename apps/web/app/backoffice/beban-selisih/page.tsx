import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBeban } from "@/lib/receivables/dashboard-queries";
import { kandidatPenanggung } from "@/lib/receivables/return-queries";
import { BebanClient } from "./BebanClient";

export const dynamic = "force-dynamic";

export default async function BebanSelisihPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const kelola = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
  const [baris, kandidat] = await Promise.all([
    daftarBeban(),
    kelola ? kandidatPenanggung() : Promise.resolve([]),
  ]);

  return <BebanClient baris={baris} kandidat={kandidat} bolehMengelola={kelola} />;
}

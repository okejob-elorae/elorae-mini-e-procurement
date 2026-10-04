import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBeban } from "@/lib/receivables/dashboard-queries";
import { kandidatPenanggung } from "@/lib/receivables/return-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { BebanClient } from "./BebanClient";

export const dynamic = "force-dynamic";

export default async function BebanSelisihPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");

  const kelola = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
  const [baris, kandidat] = await Promise.all([
    daftarBeban(),
    kelola ? kandidatPenanggung() : Promise.resolve([]),
  ]);

  return <BebanClient baris={baris} kandidat={kandidat} bolehMengelola={kelola} />;
}

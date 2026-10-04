import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { muatDasbor } from "@/lib/receivables/dashboard-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { DasborClient } from "./DasborClient";

export const dynamic = "force-dynamic";

export default async function DasborPelunasanPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");
  return <DasborClient data={await muatDasbor()} />;
}

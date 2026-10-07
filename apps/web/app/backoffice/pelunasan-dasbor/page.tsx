import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { muatDasbor } from "@/lib/receivables/dashboard-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { DasborClient } from "./DasborClient";

export const dynamic = "force-dynamic";

export default async function DasborPelunasanPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");
  // Penonton dikirim supaya BKM yang ia catat sendiri tidak tampil sebagai
  // pekerjaannya — ia tidak boleh memutuskannya (PEMERIKSA_SAMA).
  // Nota retur yang belum dihitung tidak menyebut nilai klaimnya kepada orang
  // yang boleh menghitungnya — hitungan gudang buta.
  const bolehMenghitung = hasPermission(session.user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);
  return <DasborClient data={await muatDasbor(session.user.id ?? "", { bolehMenghitung })} />;
}

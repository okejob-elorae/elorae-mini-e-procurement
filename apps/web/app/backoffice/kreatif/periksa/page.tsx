import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { periksaDataKreatif } from "@/lib/creative/periksa-data-queries";
import { PeriksaClient } from "./PeriksaClient";

export const dynamic = "force-dynamic";

/**
 * Kreatif → Periksa data: KOL kembar, baris yang menunjuk data yang sudah tidak
 * ada, tanggal terbalik, angka janggal, dan yang belum lengkap. Hanya membaca —
 * setiap temuan dibetulkan di halaman barisnya. `creative:view`.
 */
export default async function PeriksaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  return <PeriksaClient hasil={await periksaDataKreatif()} />;
}

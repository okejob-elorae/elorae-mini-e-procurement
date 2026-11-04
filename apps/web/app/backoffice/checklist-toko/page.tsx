import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarTemplateChecklist } from "@/lib/salesman/checklist-queries";
import { TemplateListClient } from "./TemplateListClient";

export const dynamic = "force-dynamic";

/**
 * Template daftar periksa display toko. Melihat cukup `stores:view`; menyusun,
 * mengaktifkan dan menghapus butuh `stores:manage`.
 */
export default async function ChecklistTokoPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  return <TemplateListClient baris={await daftarTemplateChecklist()} bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)} />;
}

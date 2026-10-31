import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPanduan } from "@/lib/salesman/checklist-queries";
import { PanduanListClient } from "./PanduanListClient";

export const dynamic = "force-dynamic";

/** Panduan display untuk salesman. Melihat `stores:view`; menulis `stores:manage`. */
export default async function PanduanDisplayPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");
  return <PanduanListClient baris={await daftarPanduan(new Date())} bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)} />;
}

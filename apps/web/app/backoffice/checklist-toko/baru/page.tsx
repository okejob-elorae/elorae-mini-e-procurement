import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { TemplateEditor } from "../TemplateEditor";

export const dynamic = "force-dynamic";

/** Template baru — kosong, atau salinan template bawaan pakaian (`?bawaan=1`). */
export default async function TemplateBaruPage({ searchParams }: { searchParams: Promise<{ bawaan?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) redirect("/backoffice/checklist-toko");
  const { bawaan } = await searchParams;
  return <TemplateEditor awal={null} salinBawaan={bawaan === "1"} bolehKelola />;
}

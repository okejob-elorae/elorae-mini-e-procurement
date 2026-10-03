import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTemplateChecklist } from "@/lib/salesman/checklist-queries";
import { TemplateEditor } from "../TemplateEditor";

export const dynamic = "force-dynamic";

/** Ubah template. Tanpa `stores:manage` penyuntingnya tampil hanya-baca. */
export default async function UbahTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const t = await ambilTemplateChecklist(id);
  if (!t) notFound();
  return <TemplateEditor awal={t} salinBawaan={false} bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)} />;
}

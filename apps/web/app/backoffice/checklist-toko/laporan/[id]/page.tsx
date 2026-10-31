import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianHasilChecklist } from "@/lib/salesman/checklist-queries";
import { RincianHasilClient } from "./RincianHasilClient";

export const dynamic = "force-dynamic";

/** Satu hasil daftar periksa: jawaban per pertanyaan, poinnya, dan foto-fotonya. */
export default async function RincianHasilPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const r = await rincianHasilChecklist(id);
  if (!r) notFound();
  return <RincianHasilClient r={r} />;
}

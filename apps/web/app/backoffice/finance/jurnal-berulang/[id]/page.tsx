import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianTemplat } from "@/lib/finance/berulang/queries";
import { RincianTemplatClient } from "./RincianTemplatClient";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * Keuangan → Jurnal berulang → rincian templat: isi jurnalnya, keadaan
 * persetujuan, bulan-bulan jatuh tempo (diposting / tertunda / dilewati),
 * jurnal yang sudah diposting, riwayat. Melihat `journals:view`; menyetujui,
 * menghentikan, mengubah, menghapus, memposting `journals:manage`.
 */
export default async function RincianTemplatPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const t = await rincianTemplat(id);
  if (!t) notFound();
  return <RincianTemplatClient templat={t} penggunaId={session.user.id} bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}

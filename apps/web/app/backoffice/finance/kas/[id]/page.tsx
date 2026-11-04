import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianVoucher } from "@/lib/finance/kas/voucher-queries";
import { RincianVoucherClient } from "./RincianVoucherClient";

export const dynamic = "force-dynamic";

/** Rincian satu voucher kas & bank dan pembatalannya. Melihat `journals:view`; membatalkan `journals:manage`. */
export default async function RincianVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const { id } = await params;
  const v = await rincianVoucher(id);
  if (!v) notFound();
  return <RincianVoucherClient voucher={v} bolehKelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}

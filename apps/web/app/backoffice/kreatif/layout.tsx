import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { KreatifTabs } from "./KreatifTabs";

/**
 * Gerbang modul creative marketing.
 *
 * Digerbangi di layout, bukan halaman per halaman: tiga layarnya membaca data
 * yang sama dan salah satunya bisa menggerakkan stok gudang. Satu pintu lebih
 * susah ditinggalkan daripada tiga.
 */
export default async function KreatifLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) {
    redirect("/backoffice");
  }
  return (
    <div className="space-y-6">
      <KreatifTabs />
      {children}
    </div>
  );
}

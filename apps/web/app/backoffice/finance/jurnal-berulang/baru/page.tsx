import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { akunUntukAset } from "@/lib/finance/aset/queries";
import { FormTemplat } from "../FormTemplat";

export const dynamic = "force-dynamic";

/** Keuangan → Jurnal berulang → Templat baru. Butuh `journals:manage`. */
export default async function TemplatBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect("/backoffice/finance/jurnal-berulang");
  return <FormTemplat akun={await akunUntukAset()} hariIni={hariIniWib()} />;
}

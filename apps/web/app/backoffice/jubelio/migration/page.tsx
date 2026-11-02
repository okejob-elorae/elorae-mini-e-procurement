import { getEligibleItems, getMigrationSummary } from "@/app/actions/jubelio-bulk-migration";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { MigrationClient } from "./MigrationClient";

export default async function MigrationPage() {
  const [items, summary, session] = await Promise.all([
    getEligibleItems(),
    getMigrationSummary(),
    auth(),
  ]);
  // The page opens with settings_security:view; requesting needs :manage, the same permission
  // requestBulkMigration enforces, so a view-only user sees the controls locked and why.
  const izin = session?.user?.permissions ?? [];
  const bolehUbah = hasPermission(izin, PERMISSIONS.SETTINGS_SECURITY_MANAGE);
  // Links to Konfirmasi harga only for those who can open it.
  const bolehKonfirmasiHarga = hasPermission(izin, PERMISSIONS.JUBELIO_PRICES_CONFIRM);
  return (
    <MigrationClient
      initialItems={items}
      initialSummary={summary}
      bolehUbah={bolehUbah}
      bolehKonfirmasiHarga={bolehKonfirmasiHarga}
    />
  );
}

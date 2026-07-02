import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listStores } from "@/lib/stores/queries";
import { StoreListClient } from "./StoreListClient";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const t = await getTranslations("stores");
  const stores = await listStores({});
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <StoreListClient stores={stores} />
    </div>
  );
}

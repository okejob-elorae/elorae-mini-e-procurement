import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listActiveStoreOptions } from "@/lib/stores/queries";
import { NewStoreTransferForm } from "./NewStoreTransferForm";

export const dynamic = "force-dynamic";

export default async function NewStoreTransferPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
    redirect("/backoffice/store-transfers");
  }

  const storeOptions = await listActiveStoreOptions();

  return <NewStoreTransferForm storeOptions={storeOptions} />;
}

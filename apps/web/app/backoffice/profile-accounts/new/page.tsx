import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  listAssignableStores,
  listRoleOptions,
} from "@/app/actions/profile-accounts";
import { AccountForm } from "../AccountForm";

export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/backoffice");

  const rolesResult = await listRoleOptions();
  if (!Array.isArray(rolesResult)) {
    redirect("/backoffice");
  }

  const storesResult = await listAssignableStores();
  if (!Array.isArray(storesResult)) {
    redirect("/backoffice");
  }

  return (
    <div className="space-y-6">
      <AccountForm
        mode="create"
        roles={rolesResult}
        stores={storesResult}
        initial={{ name: "", email: "", roleId: "", assignedStoreId: null }}
      />
    </div>
  );
}

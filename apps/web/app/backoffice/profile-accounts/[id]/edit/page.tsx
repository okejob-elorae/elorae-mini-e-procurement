import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getAccount,
  listRoleOptions,
  type AccountListItem,
} from "@/app/actions/profile-accounts";
import { AccountForm } from "../../AccountForm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function isAccount(value: unknown): value is AccountListItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "email" in value &&
    !("ok" in value)
  );
}

export default async function EditAccountPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/backoffice");

  const { id } = await params;

  const [accountResult, rolesResult] = await Promise.all([
    getAccount(id),
    listRoleOptions(),
  ]);

  if (!Array.isArray(rolesResult)) {
    redirect("/backoffice");
  }
  if (!isAccount(accountResult)) {
    if (
      accountResult &&
      typeof accountResult === "object" &&
      "code" in accountResult &&
      accountResult.code === "userNotFound"
    ) {
      notFound();
    }
    redirect("/backoffice");
  }

  return (
    <div className="space-y-6">
      <AccountForm
        mode="edit"
        userId={accountResult.id}
        roles={rolesResult}
        initial={{
          name: accountResult.name ?? "",
          email: accountResult.email,
          roleId: accountResult.roleId ?? "",
        }}
      />
    </div>
  );
}

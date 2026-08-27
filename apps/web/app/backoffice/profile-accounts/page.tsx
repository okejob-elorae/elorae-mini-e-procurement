import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRoles, getPermissions } from "@/app/actions/rbac";
import { listAccounts, type AccountListItem } from "@/app/actions/profile-accounts";
import { ProfileAccountsPageClient } from "./ProfileAccountsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileAccountsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/backoffice");

  const sp = await searchParams;
  const tab = sp.tab === "roles" ? "roles" : "accounts";

  const [accountsResult, roles, permissions] = await Promise.all([
    listAccounts(),
    getRoles(),
    getPermissions(),
  ]);

  if (!Array.isArray(accountsResult)) {
    redirect("/backoffice");
  }

  return (
    <ProfileAccountsPageClient
      initialTab={tab}
      accounts={accountsResult as AccountListItem[]}
      roles={roles}
      permissions={permissions}
    />
  );
}

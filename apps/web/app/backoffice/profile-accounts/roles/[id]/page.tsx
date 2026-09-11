import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRole, getPermissions } from "@/app/actions/rbac";
import { RoleEditClient } from "./RoleEditClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function RoleEditPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/backoffice");

  const { id } = await params;
  const [role, permissions] = await Promise.all([
    getRole(id),
    getPermissions(),
  ]);

  if (!role) notFound();

  return (
    <div className="space-y-6">
      <RoleEditClient role={role} permissions={permissions} />
    </div>
  );
}

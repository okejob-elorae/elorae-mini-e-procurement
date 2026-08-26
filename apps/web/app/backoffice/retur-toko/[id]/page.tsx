import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianRetur } from "@/lib/receivables/return-queries";
import { RincianReturClient } from "./RincianReturClient";

export const dynamic = "force-dynamic";

export default async function RincianReturPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await rincianRetur(id);
  if (!data) notFound();

  return (
    <RincianReturClient
      data={data}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

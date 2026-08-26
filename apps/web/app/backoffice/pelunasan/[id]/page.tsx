import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianKlaim } from "@/lib/receivables/claim-queries";
import { RincianKlaimClient } from "./RincianKlaimClient";

export const dynamic = "force-dynamic";

export default async function RincianKlaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await rincianKlaim(id);
  if (!data) notFound();

  return (
    <RincianKlaimClient
      data={data}
      bolehMemutuskan={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.JOURNALS_MANAGE,
      )}
    />
  );
}

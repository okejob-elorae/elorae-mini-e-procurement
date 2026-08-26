import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kandidatPenanggung, rincianRetur } from "@/lib/receivables/return-queries";
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
  const kelola = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
  const [data, kandidat] = await Promise.all([
    rincianRetur(id),
    kelola ? kandidatPenanggung() : Promise.resolve([]),
  ]);
  if (!data) notFound();

  return (
    <RincianReturClient
      data={data}
      kandidat={kandidat}
      bolehMengelola={kelola}
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMengelola } from "@/lib/receivables/izin";
import { rincianKontrabon } from "@/lib/receivables/collection-queries";
import { RincianKontrabonClient } from "./RincianKontrabonClient";

export const dynamic = "force-dynamic";

export default async function RincianKontrabonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await rincianKontrabon(id);
  if (!data) notFound();

  return (
    <RincianKontrabonClient data={data} bolehMengelola={bolehMengelola(session.user.permissions)} />
  );
}

import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMembukaKonsi, bolehMengelolaKonsi } from "@/lib/receivables/izin";
import { rincianSiklus } from "@/lib/konsinyasi/queries";
import { katalogBarang } from "@/lib/receivables/return-queries";
import { RincianSiklusClient } from "./RincianSiklusClient";

export const dynamic = "force-dynamic";

export default async function RincianSiklusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  if (!bolehMembukaKonsi(session.user.permissions)) redirect("/backoffice");

  const { id } = await params;
  const kelola = bolehMengelolaKonsi(session.user.permissions);
  const [data, katalog] = await Promise.all([
    rincianSiklus(id),
    kelola ? katalogBarang() : Promise.resolve([]),
  ]);
  if (!data) notFound();

  return <RincianSiklusClient data={data} katalog={katalog} bolehMengelola={kelola} />;
}

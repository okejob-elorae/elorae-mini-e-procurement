import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMengelola } from "@/lib/receivables/izin";
import { pilihanOrangHilang, rincianHilangKantor } from "@/lib/spg/hilang-queries";
import { RincianHilangClient } from "./RincianHilangClient";

export const dynamic = "force-dynamic";

export default async function RincianBarangHilangPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  const bolehKelola = bolehMengelola(izin);
  if (!bolehKelola && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const [rincian, orang] = await Promise.all([
    rincianHilangKantor(id),
    bolehKelola ? pilihanOrangHilang() : Promise.resolve({ spg: [], sales: [] }),
  ]);
  if (!rincian) notFound();

  return <RincianHilangClient rincian={rincian} bolehKelola={bolehKelola} orang={orang} />;
}

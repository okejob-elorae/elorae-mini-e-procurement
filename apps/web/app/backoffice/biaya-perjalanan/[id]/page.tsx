import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMelihatBiaya, bolehMembayarBiaya, bolehMenyetujuiBiaya } from "@/lib/salesman/biaya";
import { rincianBiaya } from "@/lib/salesman/biaya-queries";
import { daftarAkunKasBank } from "@/lib/finance/operasional/akun-kas";
import { RincianBiayaClient } from "./RincianBiayaClient";

export const dynamic = "force-dynamic";

export default async function RincianBiayaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMelihatBiaya(izin)) redirect("/backoffice");

  const { id } = await params;
  const rincian = await rincianBiaya(id);
  if (!rincian) notFound();
  const bolehBayar = bolehMembayarBiaya(izin);
  const akunKas = bolehBayar && rincian.status === "DISETUJUI" ? await daftarAkunKasBank() : [];

  return (
    <RincianBiayaClient
      rincian={rincian}
      bolehSetujui={bolehMenyetujuiBiaya(izin)}
      bolehBayar={bolehBayar}
      akunKas={akunKas.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
      milikSendiri={rincian.salesmanId === session.user.id}
    />
  );
}

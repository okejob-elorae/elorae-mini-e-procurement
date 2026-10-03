import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMelihatBiaya, bolehMembayarBiaya, bolehMenyetujuiBiaya } from "@/lib/salesman/biaya";
import { rincianBiaya } from "@/lib/salesman/biaya-queries";
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

  return (
    <RincianBiayaClient
      rincian={rincian}
      bolehSetujui={bolehMenyetujuiBiaya(izin)}
      bolehBayar={bolehMembayarBiaya(izin)}
      milikSendiri={rincian.salesmanId === session.user.id}
    />
  );
}

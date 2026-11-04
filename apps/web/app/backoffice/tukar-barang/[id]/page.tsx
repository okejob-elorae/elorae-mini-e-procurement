import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMelihatTukar, bolehMenyelesaikanTukar, bolehMenyetujuiTukar } from "@/lib/salesman/tukar-barang";
import { rincianTukar } from "@/lib/salesman/tukar-queries";
import { RincianTukarClient } from "./RincianTukarClient";

export const dynamic = "force-dynamic";

export default async function RincianTukarPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMelihatTukar(izin)) redirect("/backoffice");

  const { id } = await params;
  const rincian = await rincianTukar(id);
  if (!rincian) notFound();

  return (
    <RincianTukarClient
      rincian={rincian}
      bolehSetujui={bolehMenyetujuiTukar(izin)}
      bolehSelesaikan={bolehMenyelesaikanTukar(izin)}
      milikSendiri={rincian.salesmanId === session.user.id}
    />
  );
}

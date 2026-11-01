import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianMutasiKantor } from "@/lib/spg/mutasi-queries";
import { RincianMutasiKantorClient } from "./RincianMutasiKantorClient";

export const dynamic = "force-dynamic";

export default async function RincianSpgTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const rincian = await rincianMutasiKantor(id);
  if (!rincian) notFound();

  // Izin tiap tombol = izin aksinya (app/actions/spg-mutasi.ts): setujui/tolak/batalkan/alihkan
  // = store_transfers:approve, putuskan selisih = store_transfers:decide_shortfall, terima atas
  // nama toko = stores:manage.
  return (
    <RincianMutasiKantorClient
      rincian={rincian}
      bolehPutuskan={hasPermission(izin, PERMISSIONS.STORE_TRANSFERS_APPROVE)}
      bolehPutuskanSelisih={hasPermission(izin, PERMISSIONS.STORE_TRANSFERS_DECIDE_SHORTFALL)}
      bolehTerima={hasPermission(izin, PERMISSIONS.STORES_MANAGE)}
      milikSendiri={rincian.pengajuId === session.user.id}
    />
  );
}

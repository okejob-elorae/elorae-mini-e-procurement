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

  return (
    <RincianMutasiKantorClient
      rincian={rincian}
      bolehPutuskan={hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)}
      bolehTerima={hasPermission(izin, PERMISSIONS.STORES_MANAGE)}
      milikSendiri={rincian.pengajuId === session.user.id}
    />
  );
}

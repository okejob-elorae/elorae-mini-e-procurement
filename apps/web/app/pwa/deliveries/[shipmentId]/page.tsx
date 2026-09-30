import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getShipmentAction } from "@/app/actions/delivery-shipments";
import { resolveEffectiveRadius, parseRadiusSetting } from "@/lib/pwa/checkin-radius";
import { podCompletionBlock } from "@/lib/delivery/pod-completion-guard";
import { CompletePodSheet } from "./CompletePodSheet";
import { NotCompletableNotice } from "./NotCompletableNotice";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ shipmentId: string }> };

export default async function CompletePodPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) redirect("/pwa");

  const { shipmentId } = await params;
  const shipment = await getShipmentAction(shipmentId);
  if (!shipment) notFound();
  /**
   * Fail fast on ownership. `getShipmentAction` deliberately admits EITHER `deliveries:ship` or
   * `deliveries:pod` (the backoffice register needs that), so it hands back ANY shipment to any
   * POD holder — which would render a fully interactive completion sheet for another salesman's
   * delivery, and only refuse at submit time after the photo and GPS were already captured.
   * `completeDeliveryShipment`'s `NOT_CARRIER` guard is the real enforcement; this is the
   * fail-fast half. `notFound()` rather than a message, matching the `!shipment` line above: a
   * shipment that is not yours should not be distinguishable from one that does not exist. This
   * covers an EXPEDITION shipment reached through this route only when its `carriedById` is null;
   * one that names this salesman falls to the method check below.
   */
  const block = podCompletionBlock(shipment, session.user.id);
  if (block === "NOT_FOUND") notFound();
  /* Same fail-fast reason for a shipment that is yours but cannot be completed here — the writer still refuses it. */
  if (block === "NOT_COMPLETABLE") {
    return (
      <NotCompletableNotice
        storeName={shipment.storeName}
        docNo={shipment.docNo}
        status={shipment.status}
        method={shipment.method}
      />
    );
  }

  const globalRadiusRow = await prisma.systemSetting.findUnique({ where: { key: "checkin.radiusMeters" } });
  const effectiveRadiusMeters = resolveEffectiveRadius(
    shipment.storeCheckinRadiusMeters,
    parseRadiusSetting(globalRadiusRow?.value),
  );

  return (
    <CompletePodSheet
      shipmentId={shipmentId}
      storeName={shipment.storeName}
      docNo={shipment.docNo}
      storeLat={shipment.storeLat}
      storeLng={shipment.storeLng}
      effectiveRadiusMeters={effectiveRadiusMeters}
      isKonsi={shipment.orderType === "KONSI"}
      lines={shipment.lines.map((l) => ({
        id: l.id,
        orderLineId: l.orderLineId,
        productName: l.productName,
        plannedQty: l.plannedQty,
      }))}
    />
  );
}

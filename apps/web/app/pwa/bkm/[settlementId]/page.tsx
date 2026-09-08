import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSettlementForPrint } from "@/lib/finance/ar-settlement/queries";
import { BkmView } from "./BkmView";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ settlementId: string }> };

/**
 * A read surface, so EITHER permission admits — same reasoning as `getShipmentAction` in
 * `app/actions/delivery-shipments.ts`: `collections:manage` (finance) must be able to open any
 * settlement's BKM, while `settlements:submit` (a salesman) only ever prints their own. The
 * ownership half below is what keeps the second case from handing out every settlement.
 */
export default async function SettlementBkmPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const permissions = session.user.permissions ?? [];
  const canManage = hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE);
  const canSubmit = hasPermission(permissions, PERMISSIONS.SETTLEMENTS_SUBMIT);
  if (!canManage && !canSubmit) redirect("/pwa");

  const { settlementId } = await params;
  const settlement = await getSettlementForPrint(settlementId);
  if (!settlement) notFound();

  /**
   * A `settlements:submit`-only viewer (a salesman) may only print a settlement they filed;
   * `collections:manage` (finance) admits any. `notFound()` rather than a message, matching the
   * `!settlement` branch above and the delivery POD page's own `NOT_CARRIER` fail-fast: a
   * settlement that is not yours should not be distinguishable from one that does not exist.
   */
  if (!canManage && settlement.salesmanId !== session.user.id) notFound();

  return <BkmView settlement={settlement} />;
}

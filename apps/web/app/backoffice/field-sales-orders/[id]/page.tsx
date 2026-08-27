import { redirect, notFound } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import {
  getFieldSalesOrderById,
  listKonsiSuggestions,
  listKonsiAssortmentGaps,
  type KonsiSuggestion,
  type KonsiAssortmentGapSuggestion,
} from "@/lib/field-sales/queries";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { FieldSalesOrderDetailClient } from "./FieldSalesOrderDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FieldSalesOrderDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const order = await getFieldSalesOrderById(id);
  if (!order) notFound();

  const canApprove = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  );
  const canDeliver = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.FIELD_SALES_ORDERS_DELIVER,
  );

  /* Never-sent suggestions are konsi-only and only useful while the transfer is still decidable. */
  const wantsKonsiSuggestions =
    order.orderType === "KONSI" && order.status === "PENDING_APPROVAL" && canApprove;
  /**
   * Degrades to an empty panel rather than taking the page down with it. There is no `error.tsx`
   * under `app/`, so an unhandled throw from this optional convenience query would replace the
   * whole detail page — Approve and Reject included — with the framework error screen.
   */
  let konsiSuggestions: KonsiSuggestion[] = [];
  let konsiAssortmentGaps: KonsiAssortmentGapSuggestion[] = [];
  if (wantsKonsiSuggestions) {
    /**
     * Independent queries — run them concurrently so one slow query doesn't serialise behind the
     * other. `allSettled`, not `all`, keeps each query's failure isolated: one rejecting must not
     * take the other's already-successful result down with it.
     */
    const [suggestionsResult, gapsResult] = await Promise.allSettled([
      listKonsiSuggestions(id),
      listKonsiAssortmentGaps(id),
    ]);
    if (suggestionsResult.status === "fulfilled") {
      konsiSuggestions = suggestionsResult.value;
    } else {
      console.error("[field-sales-orders] listKonsiSuggestions failed", { orderId: id, error: suggestionsResult.reason });
    }
    if (gapsResult.status === "fulfilled") {
      konsiAssortmentGaps = gapsResult.value;
    } else {
      console.error("[field-sales-orders] listKonsiAssortmentGaps failed", { orderId: id, error: gapsResult.reason });
    }
  }

  /**
   * Optional convenience read — a display preview only, never the authority (the writer
   * re-checks at actual approve time per spec § 4). Degrades to null on failure, same pattern
   * as konsiSuggestions/konsiAssortmentGaps above, so it never takes down Approve/Reject.
   */
  let creditCheck: { exposure: number; limit: number; overLimit: boolean } | null = null;
  if (order.orderType === "PUTUS" && order.status === "PENDING_APPROVAL" && canApprove) {
    try {
      const orderRow = await prisma.fieldSalesOrder.findUnique({ where: { id }, select: { storeId: true } });
      if (orderRow) {
        const store = await prisma.store.findUnique({ where: { id: orderRow.storeId }, select: { creditLimit: true } });
        if (store?.creditLimit !== null && store?.creditLimit !== undefined) {
          const limit = Number(store.creditLimit);
          const exposure = await computeStoreCreditExposure(prisma, orderRow.storeId);
          creditCheck = { exposure: exposure.total, limit, overLimit: exposure.total + order.total > limit };
        }
      }
    } catch (error) {
      console.error("[field-sales-orders] credit-limit check failed", { orderId: id, error });
    }
  }

  return (
    <FieldSalesOrderDetailClient
      order={order}
      canApprove={canApprove}
      canDeliver={canDeliver}
      konsiSuggestions={konsiSuggestions}
      konsiAssortmentGaps={konsiAssortmentGaps}
      creditCheck={creditCheck}
    />
  );
}

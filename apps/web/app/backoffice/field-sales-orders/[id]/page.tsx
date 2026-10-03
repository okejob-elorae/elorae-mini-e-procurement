import { redirect, notFound } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getFieldSalesOrderById, listKonsiSuggestions, type KonsiSuggestion } from "@/lib/field-sales/queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { muatPanelKredit, type PanelKredit } from "@/lib/field-sales/kredit-panel";
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
  if (wantsKonsiSuggestions) {
    try {
      konsiSuggestions = await listKonsiSuggestions(id);
    } catch (e) {
      console.error("[field-sales-orders] listKonsiSuggestions failed", { orderId: id, error: e });
    }
  }

  /*
   * Panel kredit (PUTUS saja): catatan saat pesanan dibuat + tagihan toko sekarang.
   * Sama seperti saran konsinyasi: gagal memuatnya tidak boleh menjatuhkan halaman,
   * tapi pesanan yang DITAHAN tetap butuh centang di kartu persetujuan — jadi
   * status ditahan dibaca terpisah dan ikut dikirim walau panelnya gagal.
   */
  let kredit: PanelKredit | null = null;
  if (order.orderType === "PUTUS") {
    try {
      kredit = await muatPanelKredit(id);
    } catch (e) {
      console.error("[field-sales-orders] muatPanelKredit failed", { orderId: id, error: e });
    }
  }
  const kreditDitahan =
    kredit?.ditahan ??
    (order.orderType === "PUTUS" &&
      (await prisma.fieldSalesOrder.findUnique({ where: { id }, select: { kreditDitahan: true } }))?.kreditDitahan === true);

  return (
    <FieldSalesOrderDetailClient
      order={order}
      canApprove={canApprove}
      canDeliver={canDeliver}
      konsiSuggestions={konsiSuggestions}
      kredit={kredit}
      kreditDitahan={kreditDitahan}
    />
  );
}

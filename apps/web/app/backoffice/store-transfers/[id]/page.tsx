import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getStoreTransferById } from "@/lib/stores/transfer/queries";
import { StoreTransferDetailClient } from "./StoreTransferDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function StoreTransferDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const transfer = await getStoreTransferById(id);
  if (!transfer) notFound();

  /*
   * Each button checks the same code its action enforces (app/actions/store-transfers.ts):
   * approving needs `store_transfers:approve`; cancelling someone else's PENDING transfer is the
   * reject half of that approval, while a `stores:manage` holder may still withdraw their own.
   */
  const canApprove = hasPermission(perms, PERMISSIONS.STORE_TRANSFERS_APPROVE);
  let canCancel = canApprove;
  if (!canApprove && transfer.status === "PENDING" && hasPermission(perms, PERMISSIONS.STORES_MANAGE)) {
    const own = await prisma.storeTransfer.findUnique({ where: { id }, select: { createdById: true } });
    canCancel = own?.createdById === session.user.id;
  }

  return <StoreTransferDetailClient transfer={transfer} canApprove={canApprove} canCancel={canCancel} />;
}

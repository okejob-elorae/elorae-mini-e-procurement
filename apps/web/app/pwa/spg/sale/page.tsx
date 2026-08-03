import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getActiveVisit } from "@/lib/stores/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { SpgSaleShell } from "./SpgSaleShell";

export const dynamic = "force-dynamic";

export default async function SpgSalePage() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { assignedStoreId: true },
  });
  if (!me?.assignedStoreId) redirect("/pwa");

  /**
   * Server-side mirror of the home CTA's "enabled when checked in" gate — a
   * direct URL hit without an active visit at the assigned store bounces back
   * to the home screen to check in first, same as the CTA being disabled there.
   */
  const active = await getActiveVisit(session.user.id);
  if (!active || active.storeId !== me.assignedStoreId) redirect("/pwa");

  const catalog = await getSellableCatalogForSpg();

  return <SpgSaleShell catalog={catalog} />;
}

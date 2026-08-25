import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getActiveVisit, getStore } from "@/lib/stores/queries";
import { createStoreStocktake } from "@/lib/stores/stocktake/writer";
import { getStoreStocktakeById } from "@/lib/stores/stocktake/queries";
import { StoreStocktakeError } from "@/lib/stores/stocktake/errors";
import { SpgStocktakeShell, type SpgStocktakeLine } from "./SpgStocktakeShell";

export const dynamic = "force-dynamic";

/**
 * Finds the store's currently open document (admin-started DRAFT or a previous SPG
 * submission still PENDING_VERIFICATION), or creates one. Mirrors what
 * `saveCountsAction`'s `{ storeId }` branch does on submit, but ahead of time — the count
 * screen needs a real, persisted `StoreStocktakeLine.id` per row before the SPG types
 * anything, since `saveCountsAction`'s `lines` payload is keyed by that id, not by
 * itemId/variantSku. Creating an empty DRAFT this way is harmless: the backoffice detail
 * page already treats "an open document exists" as the normal case (it links into it
 * instead of failing), so this never blocks the admin's own primary path.
 */
async function ensureOpenStocktakeId(storeId: string, createdById: string): Promise<string> {
  const open = await prisma.storeStocktake.findFirst({
    where: { storeId, openKey: { not: null } },
    select: { id: true },
  });
  if (open) return open.id;

  try {
    const created = await createStoreStocktake({ storeId, createdById, countedAt: new Date() });
    return created.id;
  } catch (e) {
    if (e instanceof StoreStocktakeError && e.code === "ALREADY_OPEN") {
      /* Lost a create race to another concurrent request — reuse whichever document won. */
      const race = await prisma.storeStocktake.findFirst({
        where: { storeId, openKey: { not: null } },
        select: { id: true },
      });
      if (race) return race.id;
    }
    throw e;
  }
}

export default async function SpgStocktakePage() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { assignedStoreId: true },
  });
  if (!me?.assignedStoreId) redirect("/pwa");

  const [store, active] = await Promise.all([getStore(me.assignedStoreId), getActiveVisit(session.user.id)]);

  /**
   * Server-side mirror of the home CTA's gate — a direct URL hit without the right
   * store/terms/check-in state bounces back to the home screen, same as the CTA being
   * disabled or absent there.
   */
  if (!store || store.termsType !== "KONSI") redirect("/pwa");
  if (!active || active.storeId !== store.id) redirect("/pwa");

  const stocktakeId = await ensureOpenStocktakeId(store.id, session.user.id);
  const doc = await getStoreStocktakeById(stocktakeId);

  /**
   * Only the fields an SPG is allowed to see leave this page — no cause, reason, variance,
   * sold-in-window figures or live-drift figures. The SPG counts; the admin classifies.
   */
  const lines: SpgStocktakeLine[] = (doc?.lines ?? []).map((l) => ({
    lineId: l.id,
    itemId: l.itemId,
    itemSku: l.itemSku,
    variantSku: l.variantSku,
    productName: l.productName,
    expectedQty: l.expectedQty,
    countedQty: l.countedQty,
    isAdded: l.isAdded,
  }));

  return <SpgStocktakeShell storeId={store.id} storeName={store.name} lines={lines} />;
}

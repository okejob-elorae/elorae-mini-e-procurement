import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getActiveVisit, getStore } from "@/lib/stores/queries";
import { buildStocktakeLines, previousApprovedCountedAt } from "@/lib/stores/stocktake/queries";
import { SpgStocktakeShell, type SpgStocktakeLine } from "./SpgStocktakeShell";

export const dynamic = "force-dynamic";

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

  /**
   * Read-only, deliberately. The document itself is created — or an existing open one is
   * reused — inside `saveCountsAction` on submit, never here: a render can happen with no
   * submit ever following it (a re-render, a back-and-forth navigation), so it must never
   * carry a write the SPG never asked for.
   */
  const [openDoc, periodFrom] = await Promise.all([
    prisma.storeStocktake.findFirst({
      where: { storeId: store.id, openKey: { not: null } },
      select: {
        lines: {
          select: { itemId: true, variantSku: true, productName: true, expectedQty: true, countedQty: true, isAdded: true },
        },
      },
    }),
    previousApprovedCountedAt(prisma, store.id),
  ]);
  const ledgerLines = await buildStocktakeLines(prisma, store.id, periodFrom, new Date());

  const itemIds = Array.from(new Set([...ledgerLines.map((l) => l.itemId), ...(openDoc?.lines.map((l) => l.itemId) ?? [])]));
  const items = itemIds.length > 0 ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true } }) : [];
  const skuByItemId = new Map(items.map((i) => [i.id, i.sku]));

  const docLineByKey = new Map(
    (openDoc?.lines ?? []).map((l) => [
      `${l.itemId}::${l.variantSku}`,
      { countedQty: l.countedQty === null ? null : l.countedQty.toNumber(), isAdded: l.isAdded },
    ]),
  );

  /**
   * Only the fields an SPG is allowed to see leave this page — no cause, reason, variance,
   * sold-in-window or live-drift figures. The SPG counts; the admin classifies. The live ledger
   * (`buildStocktakeLines`) is the base row set, not the open document's own lines — a
   * `StoreStock` row that appeared after the document was opened must still be countable.
   */
  const seenKeys = new Set<string>();
  const lines: SpgStocktakeLine[] = ledgerLines.map((l) => {
    const key = `${l.itemId}::${l.variantSku}`;
    seenKeys.add(key);
    const saved = docLineByKey.get(key);
    return {
      itemId: l.itemId,
      itemSku: skuByItemId.get(l.itemId) ?? "",
      variantSku: l.variantSku,
      productName: l.productName,
      expectedQty: l.expectedQty,
      countedQty: saved?.countedQty ?? null,
      isAdded: saved?.isAdded ?? false,
    };
  });

  /**
   * A line already on the open document but missing from the live ledger — an item added
   * through the picker on an earlier save, or a ledger row that no longer exists — still needs
   * to render so its saved count is never silently dropped from view.
   */
  for (const l of openDoc?.lines ?? []) {
    const key = `${l.itemId}::${l.variantSku}`;
    if (seenKeys.has(key)) continue;
    lines.push({
      itemId: l.itemId,
      itemSku: skuByItemId.get(l.itemId) ?? "",
      variantSku: l.variantSku,
      productName: l.productName,
      expectedQty: l.expectedQty.toNumber(),
      countedQty: l.countedQty === null ? null : l.countedQty.toNumber(),
      isAdded: true,
    });
  }

  return <SpgStocktakeShell storeId={store.id} storeName={store.name} lines={lines} />;
}

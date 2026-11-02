import { prisma, type JubelioOutboxEntityType, type Prisma } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
import { hasPushableChange, type PushableSnapshot } from "@/lib/items/jubelio-push-diff";

/**
 * Product pushes from the ERP to Jubelio.
 *
 * The selling price is NOT one of the reasons to push (owner decision 2026-11-02): a typed price
 * waits on Jubelio → Konfirmasi harga (`lib/jubelio/harga`), and only the confirmation queues the
 * push that carries it. Every push — confirmation, revert, or an ordinary edit of the name,
 * description, variants, active state or images below — is built by the apps/api handler with the
 * CONFIRMED price (`Item.jubelioConfirmedPrice`), never the raw `sellingPrice`.
 *
 * Creating a product in Jubelio is a REQUEST, not a push: the item form, a ticked item import, the
 * item page's "Ajukan ke Jubelio" and the bulk migration stamp the request (`lib/jubelio/harga/
 * pengajuan.ts`), and confirming its price creates it. Edits push only items Jubelio already knows.
 */

/** Inserts one product_push outbox row. Takes a transaction so a confirmation commits with its push. */
export async function createProductPushRow(
  client: Prisma.TransactionClient | typeof prisma,
  itemId: string,
  userId: string | null,
): Promise<{ id: string }> {
  return client.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
}

/** Best-effort direct enqueue, after commit; the poller picks the row up within ~5s if it fails. */
export function fireProductPushNow(rowId: string, userId: string | null): void {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId: userId ?? "" }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
  userId: string | null,
): Promise<void> {
  if (!hasPushableChange(before, after)) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;

  /**
   * Only an item Jubelio already knows is pushed on edit. Creating a product in Jubelio is a
   * deliberate request that waits for its price to be confirmed — never a side effect of editing
   * a field or an image.
   */
  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping) return;

  const row = await createProductPushRow(prisma, itemId, userId);
  fireProductPushNow(row.id, userId);
}

// Image-only edits don't flow through PushableSnapshot diff (image change isn't
// in the field set). Same gating as Update otherwise — FINISHED_GOOD with an
// existing Jubelio mapping. Caller decides whether anything actually changed (counts > 0).
export async function enqueueProductPushOnImageChange(itemId: string, userId: string | null): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;

  /**
   * Only an item Jubelio already knows is pushed on edit. Creating a product in Jubelio is a
   * deliberate request that waits for its price to be confirmed — never a side effect of editing
   * a field or an image.
   */
  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping) return;

  const row = await createProductPushRow(prisma, itemId, userId);
  fireProductPushNow(row.id, userId);
}

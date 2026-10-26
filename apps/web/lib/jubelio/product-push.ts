import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
import { hasPushableChange, type PushableSnapshot } from "@/lib/items/jubelio-push-diff";

async function fireDirectEnqueue(rowId: string, userId: string): Promise<void> {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnCreate(
  itemId: string,
  userId: string | null,
  opts?: { directEnqueue?: boolean },
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;
  if (item.source !== "ERP") return;

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  if (opts?.directEnqueue !== false) void fireDirectEnqueue(row.id, userId ?? "");
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
   * deliberate act — the create-time push, a ticked import, or the item page's "Create in
   * Jubelio" button — never a side effect of editing a field or an image.
   */
  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping) return;

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId ?? "");
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
   * deliberate act — the create-time push, a ticked import, or the item page's "Create in
   * Jubelio" button — never a side effect of editing a field or an image.
   */
  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping) return;

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId ?? "");
}

"use server";

import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import { hasPushableChange, type PushableSnapshot } from "@/lib/items/jubelio-push-diff";

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function fireDirectEnqueue(rowId: string, userId: string): Promise<void> {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnCreate(itemId: string): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;
  if (item.source !== "ERP") return;

  const userId = await currentUserId();
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

export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
): Promise<void> {
  if (!hasPushableChange(before, after)) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;

  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping && item.source !== "ERP") return;

  const userId = await currentUserId();
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

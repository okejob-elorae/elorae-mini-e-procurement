"use server";

import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import { hasPushableChange, type PushableSnapshot } from "@/lib/items/jubelio-push-diff";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  jubelioCreateEligibility,
  type JubelioCreateEligibility,
} from "@/lib/items/jubelio-create-eligibility";

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function fireDirectEnqueue(rowId: string, userId: string): Promise<void> {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnCreate(
  itemId: string,
  opts?: { directEnqueue?: boolean },
): Promise<void> {
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
  if (opts?.directEnqueue !== false) void fireDirectEnqueue(row.id, userId ?? "");
}

export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
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

// Image-only edits don't flow through PushableSnapshot diff (image change isn't
// in the field set). Same gating as Update otherwise — FINISHED_GOOD with an
// existing Jubelio mapping. Caller decides whether anything actually changed (counts > 0).
export async function enqueueProductPushOnImageChange(itemId: string): Promise<void> {
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

/* The item page's "Buat di Jubelio" button — for ERP finished goods that never reached Jubelio (e.g. imported with the Jubelio box unticked). */
export async function createItemInJubelio(
  itemId: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | Exclude<JubelioCreateEligibility, "eligible"> }> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT)) {
    return { ok: false, reason: "forbidden" };
  }
  if (typeof itemId !== "string") return { ok: false, reason: "not_found" };
  const eligibility = await jubelioCreateEligibility(itemId);
  if (eligibility !== "eligible") return { ok: false, reason: eligibility };
  await enqueueProductPushOnCreate(itemId);
  return { ok: true };
}

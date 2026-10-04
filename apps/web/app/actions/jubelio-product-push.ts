"use server";

import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hasPushableChange, type PushableSnapshot } from "@/lib/items/jubelio-push-diff";

/**
 * Pengguna sesi yang boleh mengantre push produk, atau null.
 *
 * Setiap ekspor di berkas ini bisa dipanggil langsung oleh siapa pun yang masuk,
 * jadi izinnya diperiksa di sini — sama dengan aksi barang yang memanggilnya
 * (`createItem` → `items:create`, `updateItem` → `items:edit`, gambar →
 * `items:manage`). Tanpa izin aksinya diam saja seperti saat barang tidak
 * memenuhi syarat push: pemanggil internal memakai `void`/`.catch(() => {})`,
 * jadi melempar hanya akan menjadi penolakan yang tak tertangani.
 */
async function penggunaBolehPush(izin: string[]): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const perms = session.user.permissions ?? [];
  return izin.some((c) => hasPermission(perms, c)) ? id : null;
}

const IZIN_PUSH_BUAT = [PERMISSIONS.ITEMS_CREATE, PERMISSIONS.ITEMS_EDIT, PERMISSIONS.ITEMS_MANAGE];
const IZIN_PUSH_UBAH = [PERMISSIONS.ITEMS_EDIT, PERMISSIONS.ITEMS_MANAGE];

async function fireDirectEnqueue(rowId: string, userId: string): Promise<void> {
  void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
    // poller picks it up within ~5s if this fails
  });
}

export async function enqueueProductPushOnCreate(itemId: string): Promise<void> {
  const userId = await penggunaBolehPush(IZIN_PUSH_BUAT);
  if (!userId) return;
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
  void fireDirectEnqueue(row.id, userId);
}

export async function enqueueProductPushOnUpdate(
  itemId: string,
  before: PushableSnapshot,
  after: PushableSnapshot,
): Promise<void> {
  const userId = await penggunaBolehPush(IZIN_PUSH_UBAH);
  if (!userId) return;
  if (!hasPushableChange(before, after)) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;

  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping && item.source !== "ERP") return;

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId);
}

// Image-only edits don't flow through PushableSnapshot diff (image change isn't
// in the field set). Same gating as Update otherwise — FINISHED_GOOD + mapping
// or ERP-source. Caller decides whether anything actually changed (counts > 0).
export async function enqueueProductPushOnImageChange(itemId: string): Promise<void> {
  const userId = await penggunaBolehPush(IZIN_PUSH_UBAH);
  if (!userId) return;
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, type: true, source: true },
  });
  if (!item) return;
  if (item.type !== "FINISHED_GOOD") return;

  const hasMapping = (await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0;
  if (!hasMapping && item.source !== "ERP") return;

  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "product_push" satisfies JubelioOutboxEntityType,
      entityId: itemId,
      payload: {},
      enqueuedById: userId,
    },
    select: { id: true },
  });
  void fireDirectEnqueue(row.id, userId);
}

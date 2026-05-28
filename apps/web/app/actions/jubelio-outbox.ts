"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";

const STATUSES = ["PENDING", "PROCESSING", "DONE", "SKIPPED", "DEAD"] as const;
type Status = (typeof STATUSES)[number];

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.permissions?.includes("*") ?? false;
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export type JubelioOutboxFilters = {
  limit?: number;
  offset?: number;
  status?: Status;
  entityType?: string;
};

export async function pushItemStockToJubelio(itemId: string): Promise<{ ok: boolean; outboxId?: string }> {
  if (!(await isAdmin())) return { ok: false };
  const enqueuedById = await currentUserId();
  const row = await prisma.jubelioOutbox.create({
    data: { entityType: "stock_push", entityId: itemId, payload: {}, enqueuedById },
    select: { id: true },
  });
  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, {
    userId: enqueuedById ?? "",
  }).catch(() => {
    // swallow: poller picks it up within ~5s if this fails
  });
  return { ok: true, outboxId: row.id };
}

export async function bulkPushAllStockToJubelio(): Promise<{ ok: boolean; count: number }> {
  if (!(await isAdmin())) return { ok: false, count: 0 };
  const enqueuedById = await currentUserId();
  const mappings = await prisma.jubelioProductMapping.findMany({
    select: { itemId: true },
    distinct: ["itemId"],
  });
  if (mappings.length === 0) return { ok: true, count: 0 };
  await prisma.jubelioOutbox.createMany({
    data: mappings.map((m) => ({
      entityType: "stock_push",
      entityId: m.itemId,
      payload: {},
      enqueuedById,
    })),
  });
  return { ok: true, count: mappings.length };
}

export async function getJubelioOutboxRows(filters: JubelioOutboxFilters = {}) {
  if (!(await isAdmin())) return { rows: [], total: 0 };

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.entityType) where.entityType = filters.entityType;

  const [rows, total] = await Promise.all([
    prisma.jubelioOutbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { enqueuedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.jubelioOutbox.count({ where }),
  ]);

  return { rows, total };
}

export async function getJubelioOutboxStats() {
  if (!(await isAdmin())) return null;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const grouped = await prisma.jubelioOutbox.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  const byStatus = STATUSES.reduce<Record<Status, number>>(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<Status, number>,
  );
  for (const g of grouped) {
    if (STATUSES.includes(g.status as Status)) {
      byStatus[g.status as Status] = g._count._all;
    }
  }
  return { windowHours, byStatus };
}

export async function retryJubelioOutboxRow(id: string): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };

  const row = await prisma.jubelioOutbox.findUnique({ where: { id }, select: { status: true } });
  if (!row) return { ok: false };
  if (row.status !== "DEAD" && row.status !== "SKIPPED") return { ok: false };

  await prisma.jubelioOutbox.update({
    where: { id },
    data: {
      status: "PENDING",
      attempts: 0,
      lastError: null,
      deadAt: null,
      lastEnqueuedAt: null,
      skipReason: null,
    },
  });
  return { ok: true };
}

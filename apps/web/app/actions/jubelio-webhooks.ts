"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";

const STATUSES = ["RECEIVED", "PROCESSING", "PROCESSED", "SKIPPED", "DEAD"] as const;
type Status = (typeof STATUSES)[number];

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.permissions?.includes("*") ?? false;
}

export type JubelioWebhookFilters = {
  limit?: number;
  offset?: number;
  status?: Status;
  event?: string;
};

export async function getJubelioWebhookEvents(filters: JubelioWebhookFilters = {}) {
  if (!(await isAdmin())) return { events: [], total: 0 };

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.event) where.event = filters.event;

  const [events, total] = await Promise.all([
    prisma.jubelioWebhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.jubelioWebhookEvent.count({ where }),
  ]);

  return { events, total };
}

export async function getJubelioWebhookStats() {
  if (!(await isAdmin())) return null;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const grouped = await prisma.jubelioWebhookEvent.groupBy({
    by: ["status"],
    where: { receivedAt: { gte: since } },
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

export async function retryJubelioWebhookEvent(id: string): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };

  const row = await prisma.jubelioWebhookEvent.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return { ok: false };
  if (row.status !== "DEAD" && row.status !== "SKIPPED") return { ok: false };

  await prisma.jubelioWebhookEvent.update({
    where: { id },
    data: {
      status: "RECEIVED",
      attempts: 0,
      lastError: null,
      deadAt: null,
      lastEnqueuedAt: null,
      skipReason: null,
    },
  });
  return { ok: true };
}

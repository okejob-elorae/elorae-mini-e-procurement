"use server";

import { prisma } from "@elorae/db";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { auth } from "@/lib/auth";

export type JubelioCourierRow = {
  id: number;
  name: string;
  syncedAt: Date;
};

export async function syncJubelioCouriers(): Promise<{ count: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const r = await apiFetch<{ count: number }>("POST", "/jubelio/couriers/sync", {
    userId: session.user.id,
    body: {},
  });
  if (!r.ok) {
    throw new Error(extractApiMessage(r.error, `Courier sync failed (${r.status})`));
  }
  return r.data as { count: number };
}

export async function listJubelioCouriers(): Promise<JubelioCourierRow[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const rows = await prisma.jubelioCourier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, syncedAt: true },
  });
  return rows;
}

export type CourierSortField = "id" | "name" | "syncedAt";
export type CourierSortDir = "asc" | "desc";

export type ListCouriersOpts = {
  search?: string;
  sortField?: CourierSortField;
  sortDir?: CourierSortDir;
  page?: number;
  pageSize?: number;
};

export type CouriersPage = {
  couriers: JubelioCourierRow[];
  totalCount: number;
};

export async function listJubelioCouriersPaged(opts: ListCouriersOpts = {}): Promise<CouriersPage> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const sortField: CourierSortField = opts.sortField ?? "name";
  const sortDir: CourierSortDir = opts.sortDir ?? "asc";
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 10;

  const where: Record<string, unknown> = {};
  if (opts.search && opts.search.trim().length > 0) {
    where.name = { contains: opts.search.trim() };
  }

  const [rows, totalCount] = await Promise.all([
    prisma.jubelioCourier.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, syncedAt: true },
    }),
    prisma.jubelioCourier.count({ where }),
  ]);

  return { couriers: rows, totalCount };
}

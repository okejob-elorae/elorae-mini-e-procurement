"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";

export type JubelioApiCallFilters = {
  limit?: number;
  offset?: number;
  onlyErrors?: boolean;
};

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.permissions?.includes("*") ?? false;
}

export async function getJubelioApiCalls(filters: JubelioApiCallFilters = {}) {
  if (!(await isAdmin())) return { calls: [], total: 0 };

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where = filters.onlyErrors ? { ok: false } : {};

  const [calls, total] = await Promise.all([
    prisma.jubelioApiCall.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.jubelioApiCall.count({ where }),
  ]);

  return { calls, total };
}

export async function getJubelioApiCallStats() {
  if (!(await isAdmin())) return null;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const where = { createdAt: { gte: since } };

  const [total, errors, rateLimited, agg] = await Promise.all([
    prisma.jubelioApiCall.count({ where }),
    prisma.jubelioApiCall.count({ where: { ...where, ok: false } }),
    prisma.jubelioApiCall.count({ where: { ...where, rateLimited: true } }),
    prisma.jubelioApiCall.aggregate({ where, _avg: { latencyMs: true } }),
  ]);

  return {
    windowHours,
    total,
    errors,
    rateLimited,
    avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
  };
}

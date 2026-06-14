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

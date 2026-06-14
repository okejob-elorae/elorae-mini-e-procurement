"use server";

import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { auth } from "@/lib/auth";

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

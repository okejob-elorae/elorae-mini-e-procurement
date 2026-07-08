import { prisma, Prisma } from "@elorae/db";
import type { ProposedStoreFields } from "./writer";

export type PendingStoreChange = {
  id: string;
  storeId: string;
  requestedByLabel: string;
  visitId: string;
  createdAtIso: string;
  proposed: ProposedStoreFields;
  old: ProposedStoreFields;
};

function decToNum(v: Prisma.Decimal | null): number | null {
  return v === null ? null : v.toNumber();
}

export async function getPendingStoreChangeRequest(storeId: string): Promise<PendingStoreChange | null> {
  const r = await prisma.storeChangeRequest.findFirst({
    where: { storeId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { name: true, email: true } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    storeId: r.storeId,
    requestedByLabel: r.requestedBy.name ?? r.requestedBy.email,
    visitId: r.visitId,
    createdAtIso: r.createdAt.toISOString(),
    proposed: { name: r.name, address: r.address, phone: r.phone, contactName: r.contactName, lat: decToNum(r.lat), lng: decToNum(r.lng) },
    old: { name: r.oldName, address: r.oldAddress, phone: r.oldPhone, contactName: r.oldContactName, lat: decToNum(r.oldLat), lng: decToNum(r.oldLng) },
  };
}

export async function listPendingStoreChangeStoreIds(storeIds: string[]): Promise<Set<string>> {
  if (storeIds.length === 0) return new Set();
  const rows = await prisma.storeChangeRequest.findMany({
    where: { storeId: { in: storeIds }, status: "PENDING" },
    select: { storeId: true },
    distinct: ["storeId"],
  });
  return new Set(rows.map((r) => r.storeId));
}

import type { Prisma } from "@elorae/db";

export class VisitOwnershipError extends Error {
  constructor(visitId: string) {
    super(`Visit ${visitId} not found for this salesman`);
    this.name = "VisitOwnershipError";
  }
}

export async function attachVisitPhoto(
  tx: Prisma.TransactionClient,
  input: { visitId: string; salesmanId: string; clientId: string; url: string; r2Key: string; caption?: string; capturedAt: Date },
): Promise<{ id: string; url: string }> {
  const existing = await tx.visitPhoto.findUnique({ where: { clientId: input.clientId }, select: { id: true, url: true } });
  if (existing) return existing;

  const visit = await tx.storeVisit.findFirst({ where: { id: input.visitId, userId: input.salesmanId }, select: { id: true } });
  if (!visit) throw new VisitOwnershipError(input.visitId);

  return tx.visitPhoto.create({
    data: {
      visitId: input.visitId,
      clientId: input.clientId,
      url: input.url,
      r2Key: input.r2Key,
      caption: input.caption,
      capturedAt: input.capturedAt,
    },
    select: { id: true, url: true },
  });
}

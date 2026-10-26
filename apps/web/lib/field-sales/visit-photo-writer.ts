import type { Prisma } from "@elorae/db";
import { MAX_PHOTOS_PER_VISIT } from "./visit-photo-cap";

export { MAX_PHOTOS_PER_VISIT };

export class VisitPhotoCapError extends Error {
  constructor(visitId: string) {
    super(`Visit ${visitId} already holds ${MAX_PHOTOS_PER_VISIT} photos`);
    this.name = "VisitPhotoCapError";
  }
}

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
  /**
   * Serialises concurrent uploads on the visit row so two at 19 cannot both pass the count below.
   * It must be the transaction's FIRST statement: under REPEATABLE READ the read view is fixed at
   * the first consistent read, so a lock taken after any plain read still counts from that older
   * snapshot. Lock-first also lets a concurrent replay of the same clientId see the first row.
   */
  await tx.$queryRaw`SELECT \`id\` FROM \`StoreVisit\` WHERE \`id\` = ${input.visitId} FOR UPDATE`;

  const existing = await tx.visitPhoto.findUnique({ where: { clientId: input.clientId }, select: { id: true, url: true } });
  if (existing) return existing;

  const visit = await tx.storeVisit.findFirst({ where: { id: input.visitId, userId: input.salesmanId }, select: { id: true } });
  if (!visit) throw new VisitOwnershipError(input.visitId);

  const count = await tx.visitPhoto.count({ where: { visitId: input.visitId } });
  if (count >= MAX_PHOTOS_PER_VISIT) throw new VisitPhotoCapError(input.visitId);

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

import { prisma } from "@elorae/db";
import { deleteFromR2 } from "@/lib/r2";

export class PackerVideoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackerVideoConflictError";
  }
}

export class PackerOrderNotFoundError extends Error {
  constructor(message = "Order not found") {
    super(message);
    this.name = "PackerOrderNotFoundError";
  }
}

type UpsertInput = {
  salesOrderId: string;
  userId: string;
  r2Key: string;
  videoUrl: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number | null;
  /** true = replace existing video; false = create only */
  replace: boolean;
};

/**
 * Create or replace the single PackingVideo row for a sales order.
 * On replace, best-effort deletes the previous R2 object.
 */
export async function upsertPackingVideo(input: UpsertInput) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    select: {
      id: true,
      packingVideo: {
        select: { id: true, r2Key: true },
      },
    },
  });
  if (!order) throw new PackerOrderNotFoundError();

  if (!input.replace && order.packingVideo) {
    throw new PackerVideoConflictError(
      "Order sudah punya video packing. Gunakan Edit untuk mengganti.",
    );
  }
  if (input.replace && !order.packingVideo) {
    throw new PackerVideoConflictError(
      "Order belum punya video. Gunakan Record Video Packing.",
    );
  }

  const oldKey = order.packingVideo?.r2Key ?? null;

  const row = order.packingVideo
    ? await prisma.packingVideo.update({
        where: { id: order.packingVideo.id },
        data: {
          r2Key: input.r2Key,
          videoUrl: input.videoUrl,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          durationSec: input.durationSec,
          updatedById: input.userId,
          replacedAt: new Date(),
        },
      })
    : await prisma.packingVideo.create({
        data: {
          salesOrderId: input.salesOrderId,
          r2Key: input.r2Key,
          videoUrl: input.videoUrl,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          durationSec: input.durationSec,
          recordedById: input.userId,
        },
      });

  if (oldKey && oldKey !== input.r2Key) {
    try {
      await deleteFromR2(oldKey);
    } catch (err) {
      console.warn("Failed to delete old packing video from R2:", oldKey, err);
    }
  }

  return row;
}

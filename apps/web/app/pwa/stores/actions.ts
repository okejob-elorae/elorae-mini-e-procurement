"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { planCheckIn } from "@/lib/pwa/visit-transitions";
import { submitStoreChangeRequest } from "@/lib/store-changes/writer";
import { parseRadiusSetting, resolveEffectiveRadius, evaluateCheckinRadius } from "@/lib/pwa/checkin-radius";

const checkInSchema = z.object({
  storeId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const checkOutSchema = z.object({
  visitId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function checkIn(input: { storeId: string; lat: number; lng: number }): Promise<{ ok: false; code: "UNAUTHORIZED" | "NOT_FOUND" } | void> {
  const parsed = checkInSchema.parse(input);
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const store = await prisma.store.findUnique({
    where: { id: parsed.storeId },
    select: { id: true, isActive: true, lat: true, lng: true, checkinRadiusMeters: true },
  });
  if (!store || !store.isActive) return { ok: false, code: "NOT_FOUND" };

  const globalRow = await prisma.systemSetting.findUnique({ where: { key: "checkin.radiusMeters" } });
  const effectiveRadius = resolveEffectiveRadius(store.checkinRadiusMeters, parseRadiusSetting(globalRow?.value));
  const radius = evaluateCheckinRadius({
    checkin: { lat: parsed.lat, lng: parsed.lng },
    store: { lat: store.lat === null ? null : store.lat.toNumber(), lng: store.lng === null ? null : store.lng.toNumber() },
    effectiveRadiusMeters: effectiveRadius,
  });

  await prisma.$transaction(async (tx) => {
    const active = await tx.storeVisit.findFirst({
      where: { userId: session.user!.id, checkoutAt: null },
      select: { id: true, storeId: true },
    });

    const plan = planCheckIn(
      parsed.storeId,
      active ? { id: active.id, storeId: active.storeId } : null,
    );

    if (plan.kind === "no-op-same-store") return;

    if (plan.kind === "auto-close-and-open") {
      await tx.storeVisit.updateMany({
        where: { userId: session.user!.id, checkoutAt: null },
        data: { checkoutAt: new Date(), autoClosed: true },
      });
    }

    await tx.storeVisit.create({
      data: {
        storeId: parsed.storeId,
        userId: session.user!.id,
        checkinLat: new Prisma.Decimal(parsed.lat),
        checkinLng: new Prisma.Decimal(parsed.lng),
        checkinDistanceMeters: radius.distanceMeters,
        checkinOutOfRadius: radius.outOfRadius,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${parsed.storeId}`);
  redirect(`/pwa/stores/${parsed.storeId}`);
}

export async function checkOut(input: { visitId: string; lat: number; lng: number }): Promise<{ alreadyClosed: boolean; storeId: string } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" }> {
  const parsed = checkOutSchema.parse(input);
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const visit = await prisma.storeVisit.findUnique({ where: { id: parsed.visitId } });
  if (!visit) return { ok: false, code: "NOT_FOUND" };
  if (visit.userId !== session.user.id) return { ok: false, code: "FORBIDDEN" };

  const result = await prisma.storeVisit.updateMany({
    where: { id: parsed.visitId, checkoutAt: null },
    data: {
      checkoutAt: new Date(),
      checkoutLat: new Prisma.Decimal(parsed.lat),
      checkoutLng: new Prisma.Decimal(parsed.lng),
    },
  });

  if (result.count === 0) {
    return { alreadyClosed: true, storeId: visit.storeId };
  }

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${visit.storeId}`);
  return { alreadyClosed: false, storeId: visit.storeId };
}

const storeChangeSchema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().min(1),
  name: z.string().min(1).max(191),
  address: z.string().min(1),
  phone: z.string().max(64).nullable(),
  contactName: z.string().max(191).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});

export type StoreChangeSubmitActionResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHORIZED" | "NO_ACTIVE_VISIT" | "ALREADY_PENDING" | "NO_CHANGES" | "VALIDATION" };

export async function submitStoreChangeRequestAction(input: {
  storeId: string; visitId: string;
  name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null;
}): Promise<StoreChangeSubmitActionResult> {
  const parsed = storeChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const { storeId, visitId, ...proposed } = parsed.data;
  const res = await submitStoreChangeRequest({ storeId, visitId, userId: session.user.id, proposed });
  if (!res.ok) return { ok: false, code: res.code };

  revalidatePath(`/pwa/stores/${storeId}`);
  return { ok: true };
}

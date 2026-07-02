"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { planCheckIn } from "@/lib/pwa/visit-transitions";
import { getActiveVisit } from "@/lib/stores/queries";

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

export async function checkIn(input: { storeId: string; lat: number; lng: number }) {
  const parsed = checkInSchema.parse(input);
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");

  const store = await prisma.store.findUnique({
    where: { id: parsed.storeId },
    select: { id: true, isActive: true },
  });
  if (!store || !store.isActive) throw new Error("NOT_FOUND");

  const active = await getActiveVisit(session.user.id);
  const plan = planCheckIn(
    parsed.storeId,
    active ? { id: active.id, storeId: active.storeId } : null,
  );

  if (plan.kind === "no-op-same-store") {
    revalidatePath("/pwa");
    revalidatePath(`/pwa/stores/${parsed.storeId}`);
    redirect("/pwa");
  }

  await prisma.$transaction(async (tx) => {
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
      },
    });
  });

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${parsed.storeId}`);
  redirect("/pwa");
}

export async function checkOut(input: { visitId: string; lat: number; lng: number }) {
  const parsed = checkOutSchema.parse(input);
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");

  const visit = await prisma.storeVisit.findUnique({ where: { id: parsed.visitId } });
  if (!visit || visit.userId !== session.user.id) throw new Error("FORBIDDEN");

  if (visit.checkoutAt !== null) {
    return { alreadyClosed: true, storeId: visit.storeId };
  }

  await prisma.storeVisit.update({
    where: { id: parsed.visitId },
    data: {
      checkoutAt: new Date(),
      checkoutLat: new Prisma.Decimal(parsed.lat),
      checkoutLng: new Prisma.Decimal(parsed.lng),
    },
  });

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${visit.storeId}`);
  return { alreadyClosed: false, storeId: visit.storeId };
}

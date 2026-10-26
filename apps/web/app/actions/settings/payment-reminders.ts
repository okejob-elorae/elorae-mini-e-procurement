"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import {
  PAYMENT_REMINDER_SETTING_KEY,
  parsePaymentReminderDays,
  validatePaymentReminderDays,
  type PaymentReminderDaysErrorCode,
} from "@/lib/purchase-orders/payment-reminder-thresholds";

export async function getPaymentReminderDays(): Promise<number[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_VIEW);

  const row = await prisma.systemSetting.findUnique({
    where: { key: PAYMENT_REMINDER_SETTING_KEY },
    select: { value: true },
  });
  return parsePaymentReminderDays(row?.value ?? null);
}

/* Gated on the same permission the reminders go to, since those are the people it nags. */
export async function setPaymentReminderDays(
  raw: string,
): Promise<{ ok: true; days: number[] } | { ok: false; code: PaymentReminderDaysErrorCode }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

  const result = validatePaymentReminderDays(raw);
  if (!result.ok) return result;

  const value = result.days.join(",");
  await prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({
      where: { key: PAYMENT_REMINDER_SETTING_KEY },
      select: { value: true },
    });
    await tx.systemSetting.upsert({
      where: { key: PAYMENT_REMINDER_SETTING_KEY },
      create: { key: PAYMENT_REMINDER_SETTING_KEY, value },
      update: { value },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PO_PAYMENT_REMINDER_DAYS_UPDATE",
        entityType: "SystemSetting",
        entityId: PAYMENT_REMINDER_SETTING_KEY,
        changes: { before: { value: before?.value ?? null }, after: { value } },
        reason: null,
      },
    });
  });
  revalidatePath("/backoffice/settings/purchasing");
  return result;
}

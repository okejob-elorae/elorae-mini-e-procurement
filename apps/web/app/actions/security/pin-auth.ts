"use server";

import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { verifyPin, type PinAuthResult } from "@/lib/security/pin";
import { SENSITIVE_ACTIONS } from "@/app/actions/security/pin-constants";

export type { PinAuthResult };

const PIN_REGEX = /^\d{4,6}$/;

export async function setupPin(
  newPin: string,
  currentPin?: string
): Promise<PinAuthResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, messageKey: "unauthorized" };
  const userId = session.user.id;

  if (!PIN_REGEX.test(newPin)) {
    return { success: false, messageKey: 'pinFormatError' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  if (!user) {
    return { success: false, messageKey: 'userNotFound' };
  }

  if (user.pinHash) {
    if (!currentPin) {
      return { success: false, messageKey: 'enterCurrentPin' };
    }
    /* Through verifyPin, so a wrong current PIN spends the same attempt window as every other PIN gate. */
    const check = await verifyPin(userId, currentPin, "CHANGE_PIN", {
      fallbackEmail: session.user.email,
    });
    if (!check.success) {
      if (check.messageKey === "pinIncorrect") {
        return { success: false, messageKey: "currentPinIncorrect" };
      }
      return check;
    }
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  });
  return { success: true, messageKey: 'pinSaved' };
}

export async function getPinAttempts(
  limit = 20
): Promise<
  { id: string; action: string; success: boolean; ipAddress: string | null; createdAt: Date }[]
> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const userId = session.user.id;
  const attempts = await prisma.pinAttempt.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, success: true, ipAddress: true, createdAt: true },
  });
  return attempts;
}

/** Last successful PIN verification per action (for "last accessed" display). */
export async function getLastSensitiveAccess(): Promise<{ action: string; at: Date }[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const userId = session.user.id;
  const attempts = await prisma.pinAttempt.findMany({
    where: { userId, success: true, action: { in: [...SENSITIVE_ACTIONS] } },
    orderBy: { createdAt: 'desc' },
    select: { action: true, createdAt: true },
  });
  const seen = new Set<string>();
  return attempts
    .filter((a) => {
      if (seen.has(a.action)) return false;
      seen.add(a.action);
      return true;
    })
    .map((a) => ({ action: a.action, at: a.createdAt }));
}

/** Admin: list users. Uses session auth — never trust a client-supplied admin id. */
export async function getUsersForAdmin(): Promise<
  { id: string; name: string | null; email: string }[]
> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return [];
  return prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** Admin: clear PIN for another user (force reset). Uses session auth — never trust a client-supplied admin id. */
export async function adminForcePinReset(
  targetUserId: string
): Promise<PinAuthResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return { success: false, messageKey: "adminOnlyReset" };
  }
  await prisma.user.update({
    where: { id: targetUserId },
    data: { pinHash: null },
  });
  return { success: true, messageKey: "userPinReset" };
}

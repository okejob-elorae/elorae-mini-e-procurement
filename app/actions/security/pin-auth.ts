'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { SENSITIVE_ACTIONS } from '@/app/actions/security/pin-constants';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 3;

export type PinAuthResult = { success: boolean; message?: string; messageKey?: string; userId?: string };

export async function verifyPinForAction(
  userId: string,
  pin: string,
  action: string,
  reason?: string,
  ipAddress?: string,
  /** If user not found by id (e.g. session id mismatch), try lookup by this email and use that user for PIN verification. */
  fallbackEmail?: string | null
): Promise<PinAuthResult> {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, pinHash: true },
  });
  let effectiveUserId = userId;
  if (!user && fallbackEmail?.trim()) {
    const byEmail = await prisma.user.findUnique({
      where: { email: fallbackEmail.trim() },
      select: { id: true, pinHash: true },
    });
    if (byEmail) {
      user = byEmail;
      effectiveUserId = byEmail.id;
    }
  }
  if (!user) {
    return { success: false, messageKey: 'userNotFound' };
  }
  if (!user.pinHash) {
    return { success: false, messageKey: 'pinNotSet' };
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const failedCount = await prisma.pinAttempt.count({
    where: {
      userId: effectiveUserId,
      success: false,
      createdAt: { gte: since },
    },
  });
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    return { success: false, messageKey: 'tooManyAttempts' };
  }

  const match = await bcrypt.compare(pin, user.pinHash);
  await prisma.pinAttempt.create({
    data: {
      userId: effectiveUserId,
      action,
      success: match,
      ipAddress: ipAddress ?? null,
    },
  });

  if (!match) {
    return { success: false, messageKey: 'pinIncorrect' };
  }
  return { success: true, messageKey: 'ok', userId: effectiveUserId };
}

const PIN_REGEX = /^\d{4,6}$/;

export async function setupPin(
  userId: string,
  newPin: string,
  currentPin?: string
): Promise<PinAuthResult> {
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
    const match = await bcrypt.compare(currentPin, user.pinHash);
    if (!match) {
      return { success: false, messageKey: 'currentPinIncorrect' };
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
  userId: string,
  limit = 20
): Promise<
  { id: string; action: string; success: boolean; ipAddress: string | null; createdAt: Date }[]
> {
  const attempts = await prisma.pinAttempt.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, success: true, ipAddress: true, createdAt: true },
  });
  return attempts;
}

/** Last successful PIN verification per action (for "last accessed" display). */
export async function getLastSensitiveAccess(
  userId: string
): Promise<{ action: string; at: Date }[]> {
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

/** Admin: list users for force PIN reset dropdown. */
export async function getUsersForAdmin(
  adminUserId: string
): Promise<{ id: string; name: string | null; email: string }[]> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { role: true },
  });
  if (!admin || admin.role !== 'ADMIN') return [];
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return users;
}

/** Admin: clear PIN for another user (force reset). */
export async function adminForcePinReset(
  adminUserId: string,
  targetUserId: string
): Promise<PinAuthResult> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { role: true },
  });
  if (!admin || admin.role !== 'ADMIN') {
    return { success: false, messageKey: 'adminOnlyReset' };
  }
  await prisma.user.update({
    where: { id: targetUserId },
    data: { pinHash: null },
  });
  return { success: true, messageKey: 'userPinReset' };
}

'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { SENSITIVE_ACTIONS } from '@/app/actions/security/pin-constants';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 3;

export async function verifyPinForAction(
  userId: string,
  pin: string,
  action: string,
  reason?: string,
  ipAddress?: string
): Promise<{ success: boolean; message: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  if (!user) {
    return { success: false, message: 'User tidak ditemukan' };
  }
  if (!user.pinHash) {
    return { success: false, message: 'PIN belum diatur' };
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const failedCount = await prisma.pinAttempt.count({
    where: {
      userId,
      success: false,
      createdAt: { gte: since },
    },
  });
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    return {
      success: false,
      message: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.',
    };
  }

  const match = await bcrypt.compare(pin, user.pinHash);
  await prisma.pinAttempt.create({
    data: {
      userId,
      action,
      success: match,
      ipAddress: ipAddress ?? null,
    },
  });

  if (!match) {
    return { success: false, message: 'PIN salah' };
  }
  return { success: true, message: 'OK' };
}

const PIN_REGEX = /^\d{4,6}$/;

export async function setupPin(
  userId: string,
  newPin: string,
  currentPin?: string
): Promise<{ success: boolean; message: string }> {
  if (!PIN_REGEX.test(newPin)) {
    return { success: false, message: 'PIN harus 4–6 digit angka' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  if (!user) {
    return { success: false, message: 'User tidak ditemukan' };
  }

  if (user.pinHash) {
    if (!currentPin) {
      return { success: false, message: 'Masukkan PIN saat ini' };
    }
    const match = await bcrypt.compare(currentPin, user.pinHash);
    if (!match) {
      return { success: false, message: 'PIN saat ini salah' };
    }
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  });
  return { success: true, message: 'PIN berhasil disimpan' };
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
): Promise<{ success: boolean; message: string }> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { role: true },
  });
  if (!admin || admin.role !== 'ADMIN') {
    return { success: false, message: 'Hanya admin yang dapat mereset PIN' };
  }
  await prisma.user.update({
    where: { id: targetUserId },
    data: { pinHash: null },
  });
  return { success: true, message: 'PIN pengguna telah direset' };
}

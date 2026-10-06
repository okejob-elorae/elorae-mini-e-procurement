import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; /* 15 minutes */
const MAX_FAILED_ATTEMPTS = 3;

export type PinAuthResult = { success: boolean; message?: string; messageKey?: string; userId?: string };

export async function verifyPin(
  userId: string,
  pin: string,
  action: string,
  opts: {
    ipAddress?: string;
    /** If user not found by id (e.g. session id mismatch), try lookup by this email and use that user for PIN verification. */
    fallbackEmail?: string | null;
  } = {}
): Promise<PinAuthResult> {
  const { ipAddress, fallbackEmail } = opts;
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
    return { success: false, messageKey: "userNotFound" };
  }
  if (!user.pinHash) {
    return { success: false, messageKey: "pinNotSet" };
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
    return { success: false, messageKey: "tooManyAttempts" };
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
    return { success: false, messageKey: "pinIncorrect" };
  }
  return { success: true, messageKey: "ok", userId: effectiveUserId };
}

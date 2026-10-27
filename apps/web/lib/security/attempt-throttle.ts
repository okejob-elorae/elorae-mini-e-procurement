import { prisma } from "@elorae/db";

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; /* 15 minutes */
export const MAX_FAILED_ATTEMPTS = 3;
export const CHANGE_PASSWORD_ACTION = "CHANGE_PASSWORD";

export type ThrottleKind = "pin" | "password";
export type ThrottleOutcome = "blocked" | "match" | "mismatch";

/**
 * Reserve-then-compare. The attempt row is inserted as a failure BEFORE the
 * failures are counted, so N concurrent guesses each see their own row and at
 * most MAX_FAILED_ATTEMPTS of them get past the count. A refused attempt
 * deletes its own row so it does not extend the lockout. PIN counting skips
 * the password action's rows; password counting reads only them.
 */
export async function throttledCompare(opts: {
  userId: string;
  action: string;
  kind: ThrottleKind;
  ipAddress?: string;
  compare: () => Promise<boolean>;
}): Promise<ThrottleOutcome> {
  const { userId, action, kind, ipAddress, compare } = opts;
  const reserved = await prisma.pinAttempt.create({
    data: { userId, action, success: false, ipAddress: ipAddress ?? null },
    select: { id: true },
  });

  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  const failedCount = await prisma.pinAttempt.count({
    where: {
      userId,
      success: false,
      createdAt: { gte: since },
      action: kind === "password" ? CHANGE_PASSWORD_ACTION : { not: CHANGE_PASSWORD_ACTION },
    },
  });
  if (failedCount > MAX_FAILED_ATTEMPTS) {
    await prisma.pinAttempt.delete({ where: { id: reserved.id } });
    return "blocked";
  }

  const match = await compare();
  if (!match) {
    return "mismatch";
  }
  await prisma.pinAttempt.update({ where: { id: reserved.id }, data: { success: true } });
  return "match";
}

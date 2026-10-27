import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";

import { throttledCompare } from "./attempt-throttle";

export type PinAuthResult = { success: boolean; message?: string; messageKey?: string; userId?: string };

export async function verifyPin(
  userId: string,
  pin: string,
  action: string,
  opts: { ipAddress?: string } = {}
): Promise<PinAuthResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, pinHash: true },
  });
  if (!user) {
    return { success: false, messageKey: "userNotFound" };
  }
  const pinHash = user.pinHash;
  if (!pinHash) {
    return { success: false, messageKey: "pinNotSet" };
  }

  const outcome = await throttledCompare({
    userId: user.id,
    action,
    kind: "pin",
    ipAddress: opts.ipAddress,
    compare: () => bcrypt.compare(pin, pinHash),
  });
  if (outcome === "blocked") {
    return { success: false, messageKey: "tooManyAttempts" };
  }
  if (outcome === "mismatch") {
    return { success: false, messageKey: "pinIncorrect" };
  }
  return { success: true, messageKey: "ok", userId: user.id };
}

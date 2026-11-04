"use server";

import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { CHANGE_PASSWORD_ACTION, throttledCompare } from "@/lib/security/attempt-throttle";
import { SANDI_MIN } from "@/lib/users/validasi";

/**
 * Ganti kata sandi pengguna yang sedang masuk — hanya untuk diri sendiri.
 *
 * Pengguna diambil dari sesi, tidak pernah dari argumen: dulu id dikirim
 * pemanggil, jadi siapa pun yang masuk bisa menebak sandi orang lain tanpa
 * batas lewat aksi ini. Tebakan "sandi saat ini" dibatasi lewat
 * `throttledCompare` (dicatat di basis data, berlaku lintas proses).
 */
export type ChangePasswordResult =
  | { success: true }
  | { success: false; messageKey: string };

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, messageKey: "unauthorized" };
  const userId = session.user.id;

  if (typeof currentPassword !== "string" || !currentPassword.trim()) {
    return { success: false, messageKey: "currentPasswordRequired" };
  }
  if (typeof newPassword !== "string" || !newPassword.trim()) {
    return { success: false, messageKey: "newPasswordRequired" };
  }
  if (newPassword.length < SANDI_MIN) {
    return { success: false, messageKey: "passwordMinLength8" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    return { success: false, messageKey: "userNotFound" };
  }
  if (!user.passwordHash) {
    return { success: false, messageKey: "noPasswordSet" };
  }

  const passwordHash = user.passwordHash;
  const outcome = await throttledCompare({
    userId,
    action: CHANGE_PASSWORD_ACTION,
    kind: "password",
    compare: () => bcrypt.compare(currentPassword, passwordHash),
  });
  if (outcome === "blocked") {
    return { success: false, messageKey: "tooManyAttempts" };
  }
  if (outcome === "mismatch") {
    return { success: false, messageKey: "currentPasswordIncorrect" };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  return { success: true };
}

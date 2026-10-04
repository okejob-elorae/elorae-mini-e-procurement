"use server";

import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { createLoginThrottle } from "@/lib/auth/login-throttle";

/**
 * Ganti kata sandi pengguna yang sedang masuk — hanya untuk diri sendiri.
 *
 * Pengguna diambil dari sesi, tidak pernah dari argumen: dulu id dikirim
 * pemanggil, jadi siapa pun yang masuk bisa menebak sandi orang lain tanpa
 * batas lewat aksi ini.
 *
 * Tebakan "sandi saat ini" dibatasi dengan mekanisme throttle yang sama dengan
 * formulir login, tetapi penghitungnya sendiri dan lebih ketat: lima salah
 * dalam 15 menit mengunci 15 menit (pesan `tooManyAttempts` menyebut 15 menit).
 * Penghitung hidup di memori proses, seperti throttle login.
 */
const tebakanSandi = createLoginThrottle(
  { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  () => Date.now(),
);

export type ChangePasswordResult =
  | { success: true }
  | { success: false; messageKey: string };

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, messageKey: "userNotFound" };
  }
  if (typeof currentPassword !== "string" || !currentPassword.trim()) {
    return { success: false, messageKey: "currentPasswordRequired" };
  }
  if (typeof newPassword !== "string" || !newPassword.trim()) {
    return { success: false, messageKey: "newPasswordRequired" };
  }
  if (newPassword.length < 6) {
    return { success: false, messageKey: "passwordMinLength" };
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

  // Periksa dan catat tebakan tanpa `await` di antaranya: permintaan serentak
  // tidak bisa sama-sama lolos sebelum salah satunya tercatat. Catatan dihapus
  // lagi bila sandinya benar.
  if (tebakanSandi.retryAfterMs(userId) > 0) {
    return { success: false, messageKey: "tooManyAttempts" };
  }
  tebakanSandi.recordFailure(userId);

  const currentMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentMatch) {
    return { success: false, messageKey: "currentPasswordIncorrect" };
  }
  tebakanSandi.reset(userId);

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  return { success: true };
}

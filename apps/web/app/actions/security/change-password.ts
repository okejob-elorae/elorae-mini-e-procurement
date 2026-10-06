'use server';

import { prisma } from '@elorae/db';
import bcrypt from 'bcryptjs';
import { auth } from '@/lib/auth';

export type ChangePasswordResult =
  | { success: true }
  | { success: false; messageKey: string };

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, messageKey: "unauthorized" };
  const userId = session.user.id;

  if (!currentPassword?.trim()) {
    return { success: false, messageKey: 'currentPasswordRequired' };
  }
  if (!newPassword?.trim()) {
    return { success: false, messageKey: 'newPasswordRequired' };
  }
  if (newPassword.length < 6) {
    return { success: false, messageKey: 'passwordMinLength' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    return { success: false, messageKey: 'userNotFound' };
  }
  if (!user.passwordHash) {
    return { success: false, messageKey: 'noPasswordSet' };
  }

  const currentMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentMatch) {
    return { success: false, messageKey: 'currentPasswordIncorrect' };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  return { success: true };
}

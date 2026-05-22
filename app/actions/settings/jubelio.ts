'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { readJubelioTokenFromDb, refreshJubelioToken } from '@/lib/jubelio/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

export type JubelioTokenState = {
  token: string | null;
  updatedAt: string | null;
};

export async function getJubelioTokenState(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const row = await readJubelioTokenFromDb();

  return {
    token: row.token,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function refreshJubelioSessionFromEnv(): Promise<{ token: string }> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const token = await refreshJubelioToken();

  revalidatePath('/backoffice/settings');
  revalidatePath('/backoffice/settings/jubelio');

  return { token };
}

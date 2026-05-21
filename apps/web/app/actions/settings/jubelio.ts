'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

const JUBELIO_API_BASE_URL = 'https://api2.jubelio.com';
const JUBELIO_TOKEN_KEY = 'JUBELIO_SESSION_TOKEN';

type JubelioLoginResponse = {
  token?: string;
  error?: string;
  message?: string;
};

export type JubelioTokenState = {
  token: string | null;
  updatedAt: string | null;
};

export async function getJubelioTokenState(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const row = await prisma.systemSetting.findUnique({
    where: { key: JUBELIO_TOKEN_KEY },
    select: { value: true, updatedAt: true },
  });

  return {
    token: row?.value ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function loginAndStoreJubelioToken(email: string, password: string): Promise<{ token: string }> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const trimmedEmail = email.trim();
  const trimmedPassword = password.trim();
  if (!trimmedEmail || !trimmedPassword) {
    throw new Error('Email and password are required');
  }

  const response = await fetch(`${JUBELIO_API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: trimmedEmail,
      password: trimmedPassword,
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as JubelioLoginResponse;
  const token = payload?.token?.trim();

  if (!response.ok || !token) {
    const reason = payload?.message || payload?.error || 'Invalid Jubelio credentials';
    throw new Error(reason);
  }

  await prisma.systemSetting.upsert({
    where: { key: JUBELIO_TOKEN_KEY },
    create: {
      key: JUBELIO_TOKEN_KEY,
      value: token,
    },
    update: {
      value: token,
    },
  });

  revalidatePath('/backoffice/settings');

  return { token };
}

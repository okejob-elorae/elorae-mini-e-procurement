'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

export type JubelioTokenState = {
  hasToken: boolean;
  updatedAt: string | null;
  expiresAt: string | null;
  expiresInSeconds: number | null;
};

export type JubelioCatalogSyncOptions = {
  dryRun?: boolean;
  itemGroupIds?: number[];
};

export type JubelioCatalogSyncResult = {
  dryRun: boolean;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    warnings: string[];
  };
  items: Array<{
    parentSku: string;
    itemSku: string;
    action: 'create' | 'update' | 'skip';
    variantCount: number;
    variantless?: boolean;
  }>;
  errors: Array<{
    parentSku?: string;
    jubelioItemGroupId?: number;
    message: string;
  }>;
};

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${INTERNAL_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status} on ${path}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function getJubelioTokenState(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  return callApi<JubelioTokenState>('/jubelio/status');
}

export async function refreshJubelioToken(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const result = await callApi<JubelioTokenState>('/jubelio/refresh', { method: 'POST' });
  revalidatePath('/backoffice/settings');
  return result;
}

export async function syncJubelioCatalog(
  opts: JubelioCatalogSyncOptions = {},
): Promise<JubelioCatalogSyncResult> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const result = await callApi<JubelioCatalogSyncResult>('/jubelio/catalog/sync', {
    method: 'POST',
    body: JSON.stringify({ dryRun: opts.dryRun ?? false, itemGroupIds: opts.itemGroupIds }),
  });
  if (!opts.dryRun) revalidatePath('/backoffice/settings');
  return result;
}

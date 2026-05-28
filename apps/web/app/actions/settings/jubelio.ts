'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/internal-api';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

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

export async function getJubelioTokenState(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const r = await apiFetch<JubelioTokenState>('GET', '/jubelio/status', {
    userId: session.user.id,
  });
  if (!r.ok) throw new Error(`API ${r.status} on /jubelio/status: ${(r.error ?? '').slice(0, 200)}`);
  return r.data as JubelioTokenState;
}

export async function refreshJubelioToken(): Promise<JubelioTokenState> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<JubelioTokenState>('POST', '/jubelio/refresh', {
    userId: session.user.id,
  });
  if (!r.ok) throw new Error(`API ${r.status} on /jubelio/refresh: ${(r.error ?? '').slice(0, 200)}`);
  revalidatePath('/backoffice/settings');
  return r.data as JubelioTokenState;
}

export async function syncJubelioCatalog(
  opts: JubelioCatalogSyncOptions = {},
): Promise<JubelioCatalogSyncResult> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<JubelioCatalogSyncResult>('POST', '/jubelio/catalog/sync', {
    userId: session.user.id,
    body: { dryRun: opts.dryRun ?? false, itemGroupIds: opts.itemGroupIds },
  });
  if (!r.ok) throw new Error(`API ${r.status} on /jubelio/catalog/sync: ${(r.error ?? '').slice(0, 200)}`);
  if (!opts.dryRun) revalidatePath('/backoffice/settings');
  return r.data as JubelioCatalogSyncResult;
}

'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { syncCatalog, type SyncCatalogOptions } from '@/lib/jubelio/sync-catalog';
import type { CatalogSyncResult } from '@/lib/jubelio/types';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';

export async function runJubelioCatalogSync(
  opts: SyncCatalogOptions = {}
): Promise<CatalogSyncResult> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const result = await syncCatalog(opts);

  if (!opts.dryRun) {
    revalidatePath('/backoffice/items');
    revalidatePath('/backoffice/settings/jubelio');
  }

  return result;
}

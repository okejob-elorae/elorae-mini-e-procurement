"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import {
  gagalJubelio,
  galatDariBalasanApi,
  jalankanAksiJubelio,
  type HasilJubelio,
} from "@/app/backoffice/jubelio/galat-jubelio";

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
    action: "create" | "update" | "skip";
    variantCount: number;
    variantless?: boolean;
  }>;
  errors: Array<{
    parentSku?: string;
    jubelioItemGroupId?: number;
    message: string;
  }>;
};

// Semua aksi di sini mengembalikan { ok, code } — tidak melempar ke layar.

export async function getJubelioTokenState(): Promise<HasilJubelio<JubelioTokenState>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

    const r = await apiFetch<JubelioTokenState>("GET", "/jubelio/status", {
      userId: session.user.id,
    });
    if (!r.ok) {
      return galatDariBalasanApi(r.status, extractApiMessage(r.error, `API ${r.status} on /jubelio/status`));
    }
    return { ok: true, data: r.data as JubelioTokenState };
  });
}

export async function refreshJubelioToken(): Promise<HasilJubelio<JubelioTokenState>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

    const r = await apiFetch<JubelioTokenState>("POST", "/jubelio/refresh", {
      userId: session.user.id,
    });
    if (!r.ok) {
      return galatDariBalasanApi(r.status, extractApiMessage(r.error, `API ${r.status} on /jubelio/refresh`));
    }
    revalidatePath("/backoffice/settings");
    return { ok: true, data: r.data as JubelioTokenState };
  });
}

export async function syncJubelioCatalog(
  opts: JubelioCatalogSyncOptions = {},
): Promise<HasilJubelio<JubelioCatalogSyncResult>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

    const r = await apiFetch<JubelioCatalogSyncResult>("POST", "/jubelio/catalog/sync", {
      userId: session.user.id,
      body: { dryRun: opts.dryRun ?? false, itemGroupIds: opts.itemGroupIds },
    });
    if (!r.ok) {
      return galatDariBalasanApi(r.status, extractApiMessage(r.error, `API ${r.status} on /jubelio/catalog/sync`));
    }
    if (!opts.dryRun) revalidatePath("/backoffice/settings");
    return { ok: true, data: r.data as JubelioCatalogSyncResult };
  });
}

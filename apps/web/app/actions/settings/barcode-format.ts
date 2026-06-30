"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import {
  parseVariantBarcodeFormat,
  VARIANT_BARCODE_FORMAT_KEY,
  type VariantBarcodeFormatConfig,
} from "@/lib/items/variant-barcode";

export type VariantBarcodeFormatState = VariantBarcodeFormatConfig & {
  updatedAt: string | null;
};

export async function getVariantBarcodeFormat(): Promise<VariantBarcodeFormatState> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_VIEW);

  const row = await prisma.systemSetting.findUnique({
    where: { key: VARIANT_BARCODE_FORMAT_KEY },
    select: { value: true, updatedAt: true },
  });

  const parsed = parseVariantBarcodeFormat(row?.value);
  return {
    ...parsed,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function saveVariantBarcodeFormat(template: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE);

  const trimmed = template.trim();
  if (!trimmed) {
    throw new Error("Barcode format template is required");
  }

  const value = JSON.stringify({ template: trimmed } satisfies VariantBarcodeFormatConfig);
  await prisma.systemSetting.upsert({
    where: { key: VARIANT_BARCODE_FORMAT_KEY },
    create: { key: VARIANT_BARCODE_FORMAT_KEY, value },
    update: { value },
  });

  revalidatePath("/backoffice/settings/item-codes");
}

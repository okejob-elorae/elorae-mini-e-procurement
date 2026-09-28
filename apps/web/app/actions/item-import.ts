"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { loadItemImportLookups } from "@/lib/items/import/lookups";
import { parseItemImportPayload, validateItemImport } from "@/lib/items/import/validate";
import { createItemsFromImport, ItemImportSkuTakenError } from "@/lib/items/import/writer";
import {
  importError,
  type ItemImportCommitResult,
  type ItemImportPreviewResult,
  type ItemImportValidatedResult,
} from "@/lib/items/import/types";
import { enqueueProductPushOnCreate } from "@/app/actions/jubelio-product-push";
import { getActorName } from "@/app/actions/notifications";
import { getUsersWithPermission, sendNotificationToUsers } from "@/lib/notifications/recipients";

async function sessionUserWithCreate(): Promise<{ id: string } | null> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.permissions, PERMISSIONS.ITEMS_CREATE)) return null;
  return { id: session.user.id };
}

const INVALID_PAYLOAD: ItemImportValidatedResult = {
  errors: [importError("INVALID_PAYLOAD")],
  preview: [],
  artikelCount: 0,
  variantCount: 0,
};

function validatedPart(v: ItemImportValidatedResult): ItemImportValidatedResult {
  return { errors: v.errors, preview: v.preview, artikelCount: v.artikelCount, variantCount: v.variantCount };
}

export async function previewItemImport(rawRows: unknown): Promise<ItemImportPreviewResult> {
  if (!(await sessionUserWithCreate())) return { status: "forbidden" };
  const rows = parseItemImportPayload(rawRows);
  if (rows === null) return { status: "validated", ...INVALID_PAYLOAD };
  const v = validateItemImport(rows, await loadItemImportLookups());
  return { status: "validated", ...validatedPart(v) };
}

export async function commitItemImport(rawRows: unknown, options: unknown): Promise<ItemImportCommitResult> {
  const user = await sessionUserWithCreate();
  if (!user) return { status: "forbidden" };
  const rows = parseItemImportPayload(rawRows);
  if (rows === null) return { status: "invalid", ...INVALID_PAYLOAD };
  const pushToJubelio =
    typeof options === "object" && options !== null && (options as { pushToJubelio?: unknown }).pushToJubelio === true;

  const v = validateItemImport(rows, await loadItemImportLookups());
  if (!v.plan) return { status: "invalid", ...validatedPart(v) };

  let created: Array<{ id: string; sku: string; nameId: string }>;
  try {
    created = await createItemsFromImport(v.plan);
  } catch (e) {
    if (e instanceof ItemImportSkuTakenError) {
      const again = validateItemImport(rows, await loadItemImportLookups());
      const errors = again.errors.length > 0 ? again.errors : [importError("SKU_TAKEN")];
      return { status: "invalid", ...validatedPart(again), errors };
    }
    console.error("[item-import] commit failed", e);
    return { status: "failed" };
  }

  let jubelioFailed = 0;
  if (pushToJubelio) {
    for (const item of created) {
      try {
        await enqueueProductPushOnCreate(item.id, { directEnqueue: false });
      } catch (e) {
        jubelioFailed += 1;
        console.error("[item-import] jubelio enqueue failed", item.id, e);
      }
    }
  }

  void notifyItemsImported(user.id, created.length, v.variantCount).catch(() => {});
  revalidatePath("/backoffice/items");
  return { status: "created", items: created, variantCount: v.variantCount, jubelioRequested: pushToJubelio, jubelioFailed };
}

/**
 * One summary notification instead of one per item. `sendNotificationToUsers` carries no VITEST
 * guard, so this caller guards itself. `ITEM_CREATED` without an `itemId` already routes to the
 * items list in `getNotificationHref`.
 */
async function notifyItemsImported(userId: string, itemCount: number, variantCount: number): Promise<void> {
  if (process.env.VITEST) return;
  const users = await getUsersWithPermission(PERMISSIONS.ITEMS_VIEW);
  if (users.length === 0) return;
  const actor = await getActorName(userId);
  await sendNotificationToUsers(users, {
    type: "ITEM_CREATED",
    title: "Products imported",
    body: `${itemCount} products (${variantCount} variants) imported by ${actor}`,
    data: {},
  });
}

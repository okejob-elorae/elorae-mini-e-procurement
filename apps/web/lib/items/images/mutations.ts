"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { enqueueProductPushOnImageChange } from "@/app/actions/jubelio-product-push";
import { deleteFromR2, keyFromUrl } from "@/lib/r2";
import {
  validateGalleryCount,
  validateNewUploadUrl,
  validateUrlHost,
  validateVariantSku,
} from "./validators";
import { diffItemImages } from "./diff";
import type {
  ItemImageDto,
  ItemImageSource,
  ItemImageSubmission,
  ReplaceImagesActionResult,
} from "./types";

async function requireManage(): Promise<{ ok: true } | ReplaceImagesActionResult> {
  const session = await auth();
  if (!session) return { ok: false, code: "forbidden", message: "Unauthorized." };
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.ITEMS_MANAGE)) {
    return { ok: false, code: "forbidden", message: "Permission denied." };
  }
  return { ok: true };
}

/**
 * The R2 bucket also holds audited evidence (delivery proofs, settlement and collection
 * photos, packing videos). An item image row must never be able to point at, or delete, any
 * of it, so a URL is only accepted when it resolves to a plain key under the item-image prefix.
 * Rejects any `..` or empty segment so the prefix cannot be escaped.
 */
function isItemImageKey(key: string | null, allowedPrefixes: string[]): key is string {
  if (typeof key !== "string") return false;
  const segments = key.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  return allowedPrefixes.some((prefix) => key.startsWith(prefix));
}

function groupCount(rows: ItemImageSubmission[], variantSku: string | null): number {
  return rows.filter((r) => r.variantSku === variantSku).length;
}

export async function replaceItemImagesAction(
  itemId: string,
  submitted: ItemImageSubmission[],
): Promise<ReplaceImagesActionResult> {
  const gate = await requireManage();
  if (!gate.ok) return gate as ReplaceImagesActionResult;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, variants: true },
  });
  if (!item) return { ok: false, code: "item_not_found", message: "Item not found." };

  const parentVariants = Array.isArray(item.variants)
    ? (item.variants as Array<{ sku?: unknown }>)
        .filter((v): v is { sku: string } => typeof v?.sku === "string" && v.sku.length > 0)
    : [];

  // Validate every submission
  for (const s of submitted) {
    const hostCheck = s.id ? validateUrlHost(s.url) : validateNewUploadUrl(s.url);
    if (!hostCheck.ok) return hostCheck;
    if (!s.id) {
      /* The upload route files new images under the item's own id, or `_pending` as a fallback. */
      const key = keyFromUrl(s.url);
      if (!isItemImageKey(key, [`items/${itemId}/`, "items/_pending/"])) {
        return {
          ok: false,
          code: "image_url_untrusted",
          message: "New uploads must be item images uploaded through the item gallery.",
        };
      }
    }
    const variantCheck = validateVariantSku(s.variantSku, parentVariants);
    if (!variantCheck.ok) return variantCheck;
  }

  // Validate gallery counts per bucket (null = product-level, each variant sku)
  const variantBuckets = new Set<string | null>([null, ...submitted.map((s) => s.variantSku)]);
  for (const bucket of variantBuckets) {
    const count = groupCount(submitted, bucket);
    const countCheck = validateGalleryCount(count);
    if (!countCheck.ok) return countCheck;
  }

  // Load current rows for diff
  const existingRows = await prisma.itemImage.findMany({ where: { itemId } });
  const existing: ItemImageDto[] = existingRows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    variantSku: r.variantSku,
    url: r.url,
    sortOrder: r.sortOrder,
    jubelioImageId: r.jubelioImageId,
    syncedAt: r.syncedAt,
    source: r.source as ItemImageSource,
  }));

  const diff = diffItemImages(existing, submitted);

  // Block deleting JUBELIO_INGEST rows
  const blockedDelete = diff.deletes.find((d) => d.source === "JUBELIO_INGEST");
  if (blockedDelete) {
    return {
      ok: false,
      code: "image_jubelio_owned",
      message: "Cannot delete Jubelio-sourced image. Remove it in Jubelio first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    if (diff.inserts.length > 0) {
      await tx.itemImage.createMany({
        data: diff.inserts.map((i) => ({
          itemId,
          variantSku: i.variantSku,
          url: i.url,
          sortOrder: i.sortOrder,
          source: "ERP_UPLOAD",
        })),
      });
    }
    for (const u of diff.updates) {
      await tx.itemImage.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } });
    }
    if (diff.deletes.length > 0) {
      await tx.itemImage.deleteMany({
        where: { id: { in: diff.deletes.map((d) => d.id) } },
      });
    }
  });

  // Best-effort R2 cleanup (only for ERP_UPLOAD rows)
  for (const d of diff.deletes) {
    if (d.source === "ERP_UPLOAD") {
      const key = keyFromUrl(d.url);
      if (!isItemImageKey(key, ["items/"])) {
        console.warn(`Skipped R2 delete for non-item-image URL ${d.url}`);
        continue;
      }
      try {
        await deleteFromR2(key);
      } catch (err) {
        console.warn(`R2 delete failed for ${d.url}:`, err);
      }
    }
  }

  const totalChanges = diff.inserts.length + diff.updates.length + diff.deletes.length;
  if (totalChanges > 0) {
    void enqueueProductPushOnImageChange(itemId);
  }

  revalidatePath(`/backoffice/items/${itemId}`);
  return {
    ok: true,
    counts: {
      inserted: diff.inserts.length,
      updated: diff.updates.length,
      deleted: diff.deletes.length,
    },
  };
}

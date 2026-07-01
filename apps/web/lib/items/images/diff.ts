import type { ItemImageDto, ItemImageSubmission, ItemImageDiff } from "./types";

export function diffItemImages(
  existing: ItemImageDto[],
  submitted: ItemImageSubmission[],
): ItemImageDiff {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const submittedIds = new Set(submitted.filter((s) => s.id).map((s) => s.id as string));

  const inserts: ItemImageDiff["inserts"] = [];
  const updates: ItemImageDiff["updates"] = [];
  const deletes: ItemImageDiff["deletes"] = [];

  for (const s of submitted) {
    if (!s.id) {
      inserts.push({ url: s.url, variantSku: s.variantSku, sortOrder: s.sortOrder });
      continue;
    }
    const e = existingById.get(s.id);
    if (e && e.sortOrder !== s.sortOrder) {
      updates.push({ id: s.id, sortOrder: s.sortOrder });
    }
  }

  for (const e of existing) {
    if (!submittedIds.has(e.id)) {
      deletes.push({ id: e.id, url: e.url, source: e.source });
    }
  }

  return { inserts, updates, deletes };
}

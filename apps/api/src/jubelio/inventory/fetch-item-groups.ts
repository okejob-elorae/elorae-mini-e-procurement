import type { Logger } from "@nestjs/common";
import type { JubelioHttpService } from "../http.service";
import type { JubelioItemGroup, JubelioItemsPayload } from "../catalog/catalog.types";

/* Jubelio documents 200 as the ceiling for pageSize. */
const PAGE_SIZE = 200;
/*
 * A hard ceiling, because some Jubelio list endpoints ignore paging entirely (see
 * categories.service.ts) and would otherwise loop forever. 100 pages is 20,000 item groups.
 */
const MAX_PAGES = 100;

/**
 * Pages through `GET /inventory/items/` until a short page, the envelope's `totalCount`, a page
 * that repeats the previous one, or the page ceiling. With `stopWhenSeen`, it also stops as soon
 * as every listed group id has been read, so a single-group caller does not page the catalog.
 */
export async function fetchItemGroups(
  http: Pick<JubelioHttpService, "get">,
  logger: Pick<Logger, "warn">,
  opts: { stopWhenSeen?: ReadonlySet<number> } = {},
): Promise<JubelioItemsPayload> {
  const allGroups: JubelioItemGroup[] = [];
  const pending = opts.stopWhenSeen ? new Set(opts.stopWhenSeen) : null;
  let expected: number | null = null;
  let previousFirstGroupId: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await http.get<JubelioItemsPayload>("/inventory/items/", {
      query: { page, pageSize: PAGE_SIZE },
    });
    const groups = Array.isArray(payload?.data) ? payload.data : [];

    const firstGroupId = groups[0]?.item_group_id ?? null;
    if (page > 1 && firstGroupId !== null && firstGroupId === previousFirstGroupId) {
      logger.warn(
        `/inventory/items/ returned the same page again at page ${page}; it looks like paging is ignored, stopping`,
      );
      break;
    }
    previousFirstGroupId = firstGroupId;

    allGroups.push(...groups);
    if (pending) {
      for (const group of groups) pending.delete(group.item_group_id);
    }

    if (expected === null) {
      const total = Number(payload?.totalCount);
      expected = Number.isFinite(total) ? total : null;
    }
    const done = groups.length < PAGE_SIZE || (expected !== null && allGroups.length >= expected);
    if (done || (pending && pending.size === 0)) break;
    if (page === MAX_PAGES) {
      logger.warn(
        `Stopped after ${MAX_PAGES} pages of /inventory/items/ with ${allGroups.length} groups; variants beyond read as no figure`,
      );
    }
  }

  if (!pending && expected !== null && allGroups.length < expected) {
    logger.warn(`Jubelio reports ${expected} item groups but only ${allGroups.length} were read`);
  }

  return { data: allGroups, totalCount: expected ?? undefined };
}

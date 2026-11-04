import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { recordJubelioObservedPrice } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { fetchItemGroups } from "../inventory/fetch-item-groups";
import { summarizeGroupsPrice } from "./map-catalog";

/** The first run after the api starts, so differences that already exist surface within a minute. */
const FIRST_RUN_DELAY_MS = 60_000;

export type PriceObserverResult = { groups: number; recorded: number; skipped: number };

/**
 * Reads what Jubelio shows for every mapped product and records it on the item (owner answers
 * 2026-11-02: P1 the highest variant price is THE Jubelio price, P2 a price edited directly in
 * Jubelio must raise a warning). The product webhook is not known to fire on a price-only edit, so
 * this is what bounds the delay: every 10 minutes, plus once a minute after the api starts.
 *
 * READ-ONLY towards everything but the observed columns: one catalog list (`GET /inventory/items/`,
 * no detail or image calls, pages kept out of the call log), mapped to items through
 * `JubelioProductMapping`, recorded only through `@elorae/db` `recordJubelioObservedPrice`. It writes
 * no item field, no mapping, no image, no selling price and no request. The warning itself is
 * derived on the web side; this never notifies anyone.
 */
@Injectable()
export class JubelioPriceObserverService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JubelioPriceObserverService.name);
  private running = false;
  private firstRun: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  onApplicationBootstrap(): void {
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    this.firstRun = null;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: "jubelio-price-observer" })
  async tick(): Promise<void> {
    try {
      const r = await this.observe();
      if (r.recorded > 0) this.logger.log(`Jubelio prices observed: ${r.recorded} recorded across ${r.groups} groups`);
    } catch (err) {
      this.logger.warn(`Jubelio price observer failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One run. An overlapping run (a slow catalog, a manual call) is skipped, not queued. */
  async observe(opts: { itemGroupIds?: number[] } = {}): Promise<PriceObserverResult> {
    if (this.running) return { groups: 0, recorded: 0, skipped: 0 };
    this.running = true;
    try {
      return await this.observeOnce(opts);
    } finally {
      this.running = false;
    }
  }

  private async observeOnce(opts: { itemGroupIds?: number[] }): Promise<PriceObserverResult> {
    const filter = opts.itemGroupIds?.length ? new Set(opts.itemGroupIds) : null;
    /* Captured BEFORE the read: a push that lands meanwhile is never overwritten by this older reading. */
    const readAt = new Date();
    const payload = await fetchItemGroups(this.http, this.logger, {
      stopWhenSeen: filter ?? undefined,
      redactResponseBody: true,
    });

    const listed = new Set<number>();
    for (const group of payload.data) {
      if (!filter || filter.has(group.item_group_id)) listed.add(group.item_group_id);
    }
    if (listed.size === 0) return { groups: 0, recorded: 0, skipped: 0 };

    const mappings = await this.prisma.jubelioProductMapping.findMany({
      where: { jubelioItemGroupId: { in: [...listed] } },
      select: { itemId: true, jubelioItemGroupId: true },
    });
    const itemsByGroup = new Map<number, Set<string>>();
    for (const m of mappings) {
      const set = itemsByGroup.get(m.jubelioItemGroupId) ?? new Set<string>();
      set.add(m.itemId);
      itemsByGroup.set(m.jubelioItemGroupId, set);
    }

    let recorded = 0;
    let skipped = 0;
    /* A group mapped to two items says nothing about which of them it prices: neither is recorded. */
    const ambiguous = new Set<string>();
    for (const [groupId, items] of itemsByGroup) {
      if (items.size <= 1) continue;
      skipped++;
      for (const id of items) ambiguous.add(id);
      this.logger.warn(`Jubelio group ${groupId} is mapped to ${items.size} items; its price is not recorded`);
    }

    /*
     * Per ITEM, over all its listed groups, exactly as the product push reads it right before
     * writing (`summarizeGroupsPrice`): the same variants — bundles and unreadable item codes
     * skipped, one row per item_id — and the same fallback. Two readings of one unchanged Jubelio
     * product must record the same figures, or `jubelioObservedChangedAt` would move on every read
     * and no price decision would ever hold (P75).
     */
    const groupsByItem = new Map<string, Set<number>>();
    for (const m of mappings) {
      if (ambiguous.has(m.itemId)) continue;
      const set = groupsByItem.get(m.itemId) ?? new Set<number>();
      set.add(m.jubelioItemGroupId);
      groupsByItem.set(m.itemId, set);
    }
    for (const [itemId, groupIds] of groupsByItem) {
      const price = summarizeGroupsPrice(payload.data, groupIds);
      if (!price) {
        skipped++;
        continue;
      }
      try {
        if (await recordJubelioObservedPrice(this.prisma, itemId, price, readAt)) recorded++;
      } catch (err) {
        skipped++;
        this.logger.warn(`Recording Jubelio's price for item ${itemId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { groups: listed.size, recorded, skipped };
  }
}

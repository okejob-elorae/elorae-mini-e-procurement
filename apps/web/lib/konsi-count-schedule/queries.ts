import { prisma } from "@elorae/db";
import {
  COUNT_DUE_DAY_SETTING_KEY,
  COUNT_LEAD_DAYS_SETTING_KEY,
  countMomentOf,
  countStatusFor,
  parseCountSchedule,
  type CountSchedule,
  type CountStatusResult,
} from "./schedule";

/* Both settings in one read. Nothing seeds them and no screen writes them, so the defaults normally apply. */
export async function readCountSchedule(): Promise<CountSchedule> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [COUNT_DUE_DAY_SETTING_KEY, COUNT_LEAD_DAYS_SETTING_KEY] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return parseCountSchedule({
    dueDay: byKey.get(COUNT_DUE_DAY_SETTING_KEY) ?? null,
    leadDays: byKey.get(COUNT_LEAD_DAYS_SETTING_KEY) ?? null,
  });
}

export type StoreCountState = CountStatusResult & {
  lastFullCount: { id: string; docNo: string; countMoment: Date | null } | null;
  openStocktakeId: string | null;
};

/**
 * Where one store stands on its monthly count, for the store screen, the SPG home and the daily
 * sweep alike. Only an APPROVED count stamped `isFullCount` can satisfy a month, because a partial
 * count cannot close a sell-through period, and it is credited by its count moment
 * (`countMomentOf`). The open count, if any, is the store's single document with a non-null
 * `openKey`.
 */
export async function getStoreCountState(
  store: { id: string; createdAt: Date },
  schedule: CountSchedule,
  now: Date,
): Promise<StoreCountState> {
  const [lastFull, open] = await Promise.all([
    prisma.storeStocktake.findFirst({
      where: { storeId: store.id, status: "APPROVED", isFullCount: true },
      /* One open count per store (`openKey`) means a count opens only after the previous one closed, so count moments rise with `approvedAt`. */
      orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
      select: { id: true, docNo: true, countFinishedAt: true, approvedAt: true },
    }),
    prisma.storeStocktake.findFirst({
      where: { storeId: store.id, openKey: { not: null } },
      select: { id: true },
    }),
  ]);
  const lastFullCount = lastFull ? { id: lastFull.id, docNo: lastFull.docNo, countMoment: countMomentOf(lastFull) } : null;
  const result = countStatusFor({
    now,
    schedule,
    lastFullCountMoment: lastFullCount?.countMoment ?? null,
    eligibleSince: store.createdAt,
  });
  return { ...result, lastFullCount, openStocktakeId: open?.id ?? null };
}

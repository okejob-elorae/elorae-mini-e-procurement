"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS, requirePermission } from "@/lib/rbac";
import { listItemCategories } from "@/lib/item-categories/queries";
import { listRates, MAX_AMOUNT_PER_PIECE, setRate } from "@/lib/spg-commission/rates";
import { SpgCommissionRateError, type SpgCommissionRateErrorCode } from "@/lib/spg-commission/errors";
import { isYearMonth, wibYearMonth } from "@/lib/spg-commission/month";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";

const PAGE_PATH = "/backoffice/settings/spg-commission";

/** The current WIB month plus the next eleven; earlier months are closed by the writer. */
const OPEN_MONTH_COUNT = 12;

export type SpgCommissionRateEntry = {
  id: string;
  itemCategoryId: string;
  effectiveFrom: string;
  amountPerPiece: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
};

export type SpgCommissionCategory = {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  rates: SpgCommissionRateEntry[];
};

export type SpgCommissionSettings = {
  currentMonth: string;
  openMonths: string[];
  categories: SpgCommissionCategory[];
};

export type SetSpgCommissionRateInput = {
  itemCategoryId: string;
  amountPerPiece: number;
  effectiveFrom: string;
};

export type SetSpgCommissionRateReason = SpgCommissionRateErrorCode | "FORBIDDEN" | "UNEXPECTED";

export type SetSpgCommissionRateResult = { ok: true } | { ok: false; reason: SetSpgCommissionRateReason };

/**
 * Every active category, plus each inactive one that still has rates (shown read-only), with its
 * full rate history newest first. The page resolves the rate in force itself, from `currentMonth`.
 */
export async function getSpgCommissionSettings(): Promise<SpgCommissionSettings> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SPG_COMMISSION_MANAGE);

  const [categories, rates] = await Promise.all([listItemCategories(), listRates()]);

  const creatorIds = [...new Set(rates.map((rate) => rate.createdById))];
  const creators = creatorIds.length === 0
    ? []
    : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } });
  const creatorName = new Map(creators.map((user) => [user.id, user.name]));

  const ratesByCategory = new Map<string, SpgCommissionRateEntry[]>();
  for (const rate of rates) {
    const entries = ratesByCategory.get(rate.itemCategoryId) ?? [];
    entries.push({
      id: rate.id,
      itemCategoryId: rate.itemCategoryId,
      effectiveFrom: rate.effectiveFrom,
      amountPerPiece: rate.amountPerPiece,
      createdAt: rate.createdAt.toISOString(),
      updatedAt: rate.updatedAt.toISOString(),
      createdByName: creatorName.get(rate.createdById) ?? null,
    });
    ratesByCategory.set(rate.itemCategoryId, entries);
  }

  const currentMonth = wibYearMonth(new Date());
  return {
    currentMonth,
    openMonths: Array.from({ length: OPEN_MONTH_COUNT }, (_, offset) => shiftYearMonth(currentMonth, offset)),
    categories: categories
      .map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
        isActive: category.isActive,
        rates: ratesByCategory.get(category.id) ?? [],
      }))
      .filter((category) => category.isActive || category.rates.length > 0),
  };
}

/**
 * Creates or replaces one category's rate from a WIB month onward. Every refusal comes back as a
 * reason code rather than a throw, so the page can show translated copy for each one.
 */
export async function setSpgCommissionRate(input: SetSpgCommissionRateInput): Promise<SetSpgCommissionRateResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions, PERMISSIONS.SPG_COMMISSION_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  /* A `"use server"` export is callable with any payload, so the declared types prove nothing yet. */
  const raw: Partial<SetSpgCommissionRateInput> = input ?? {};
  const { itemCategoryId, amountPerPiece, effectiveFrom } = raw;
  if (typeof itemCategoryId !== "string" || itemCategoryId === "") {
    return { ok: false, reason: "CATEGORY_NOT_FOUND" };
  }
  if (
    typeof amountPerPiece !== "number" ||
    !Number.isFinite(amountPerPiece) ||
    !Number.isInteger(amountPerPiece) ||
    amountPerPiece < 0 ||
    amountPerPiece > MAX_AMOUNT_PER_PIECE
  ) {
    return { ok: false, reason: "INVALID_AMOUNT" };
  }
  if (!isYearMonth(effectiveFrom)) {
    return { ok: false, reason: "INVALID_MONTH" };
  }

  try {
    await setRate({ itemCategoryId, amountPerPiece, effectiveFrom, actorId: session.user.id });
  } catch (error) {
    if (error instanceof SpgCommissionRateError) return { ok: false, reason: error.code };
    console.error("setSpgCommissionRate failed", error);
    return { ok: false, reason: "UNEXPECTED" };
  }

  revalidatePath(PAGE_PATH);
  return { ok: true };
}

import { prisma, type Prisma } from "@elorae/db";
import { SpgCommissionRateError } from "./errors";
import { compareYearMonth, isYearMonth, wibYearMonth } from "./month";

/**
 * SPG commission rates: a flat whole-rupiah amount per piece for one item category, effective from
 * a WIB month until a later row for the same category takes over (see `resolveRate`).
 *
 * Months before the current WIB month are closed: their recaps have been read, so a rate edit may
 * only take effect from the current month onward. Permission gating lives in the calling action,
 * never here (this module sits on DB specs' import chain, so it must not import `@/lib/auth`).
 */

/** `amountPerPiece` is `DECIMAL(15, 2)`, so a whole-rupiah value has at most 13 integer digits. */
export const MAX_AMOUNT_PER_PIECE = 9_999_999_999_999;

type Client = Prisma.TransactionClient | typeof prisma;

export type SpgCommissionRateRow = {
  id: string;
  itemCategoryId: string;
  amountPerPiece: number;
  effectiveFrom: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SetRateInput = {
  itemCategoryId: string;
  amountPerPiece: number;
  effectiveFrom: string;
  actorId: string;
};

function toRow(row: {
  id: string;
  itemCategoryId: string;
  amountPerPiece: Prisma.Decimal;
  effectiveFrom: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}): SpgCommissionRateRow {
  return { ...row, amountPerPiece: Number(row.amountPerPiece) };
}

/** Every rate, grouped by category and newest `effectiveFrom` first within each. */
export async function listRates(client: Client = prisma): Promise<SpgCommissionRateRow[]> {
  const rows = await client.spgCommissionRate.findMany({
    orderBy: [{ itemCategoryId: "asc" }, { effectiveFrom: "desc" }],
  });
  return rows.map(toRow);
}

/**
 * Creates or replaces the rate for one category and month. The category row is locked first, so
 * this serialises against `deleteItemCategoryRecord`, which takes the same lock before counting the
 * category's rates: a rate can never land on a category that a concurrent delete already cleared.
 * `createdById` names whoever first created the row; a later edit of the same month keeps it.
 */
export async function setRate(input: SetRateInput, now: Date = new Date()): Promise<SpgCommissionRateRow> {
  const { itemCategoryId, amountPerPiece, effectiveFrom, actorId } = input;

  if (
    !Number.isFinite(amountPerPiece) ||
    !Number.isInteger(amountPerPiece) ||
    amountPerPiece < 0 ||
    amountPerPiece > MAX_AMOUNT_PER_PIECE
  ) {
    throw new SpgCommissionRateError("INVALID_AMOUNT", String(amountPerPiece));
  }
  if (!isYearMonth(effectiveFrom)) {
    throw new SpgCommissionRateError("INVALID_MONTH", effectiveFrom);
  }
  if (compareYearMonth(effectiveFrom, wibYearMonth(now)) < 0) {
    throw new SpgCommissionRateError("MONTH_CLOSED", effectiveFrom);
  }
  if (typeof itemCategoryId !== "string" || itemCategoryId === "") {
    throw new SpgCommissionRateError("CATEGORY_NOT_FOUND");
  }

  const row = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ isActive: unknown }[]>`
      SELECT \`isActive\` FROM \`ItemCategory\` WHERE \`id\` = ${itemCategoryId} FOR UPDATE
    `;
    const category = locked[0];
    if (!category) throw new SpgCommissionRateError("CATEGORY_NOT_FOUND", itemCategoryId);
    if (!Number(category.isActive)) throw new SpgCommissionRateError("CATEGORY_INACTIVE", itemCategoryId);

    return tx.spgCommissionRate.upsert({
      where: { itemCategoryId_effectiveFrom: { itemCategoryId, effectiveFrom } },
      create: { itemCategoryId, effectiveFrom, amountPerPiece, createdById: actorId },
      update: { amountPerPiece },
    });
  });
  return toRow(row);
}

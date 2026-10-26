import { Prisma } from "@elorae/db";

/**
 * The mariadb adapter reports a unique violation's constraint as the INDEX NAME
 * (`KonsiSellThrough_chainKey_key`, `FieldSalesOrder_idempotencyKey_key`) rather than the column,
 * and where it lands in `meta` varies, so the column name is searched for across the message and
 * the whole meta blob.
 */
export function isUniqueViolationOn(e: unknown, column: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  return `${e.message} ${JSON.stringify(e.meta ?? {})}`.includes(column);
}

/**
 * Detects by shape, not `instanceof`: the prod web build bundles the Prisma runtime more than
 * once, so a `PrismaClientKnownRequestError` raised by the shared client can fail an `instanceof`
 * against the class in the importing chunk.
 *
 * The mariadb adapter reports a unique violation's constraint as the INDEX NAME
 * (`KonsiSellThrough_chainKey_key`, `FieldSalesOrder_idempotencyKey_key`) rather than the column,
 * and where it lands in `meta` varies, so the column name is searched for across the message and
 * the whole meta blob.
 */
export function isUniqueViolationOn(e: unknown, column: string): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; message?: unknown; meta?: unknown };
  if (typeof err.code !== "string" || err.code !== "P2002") return false;
  const message = typeof err.message === "string" ? err.message : "";
  return `${message} ${JSON.stringify(err.meta ?? {})}`.includes(column);
}

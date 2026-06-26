import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "./db-connection";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaSchemaStamp: string | undefined;
};

/**
 * Fingerprint of the current generated schema (sorted model names). Stamped onto
 * the dev singleton at creation; a mismatch on reload means the schema changed,
 * so the cached client is stale and must be recreated. Auto-tracks every model —
 * no per-delegate edits when the schema grows.
 */
const SCHEMA_STAMP = Object.keys(Prisma.ModelName).sort().join(",");

function createPrismaClient(): PrismaClient {
  const url = getDatabaseUrl() || process.env.DATABASE_URL || "";
  const adapter = new PrismaMariaDb(url);
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && globalForPrisma.prismaSchemaStamp !== SCHEMA_STAMP) {
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
    globalForPrisma.prismaSchemaStamp = SCHEMA_STAMP;
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = client[prop as keyof PrismaClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export * from "../generated/prisma/client";
export { getDatabaseUrl } from "./db-connection";
export {
  createItemFromIngest,
  updateItemFromIngest,
  type IngestItemCreateData,
  type IngestItemUpdateData,
} from "./item-writer";
export {
  applyJubelioStockAdjustment,
  InventoryValueMissingError,
  type ApplyJubelioStockAdjustmentInput,
  type ApplyJubelioStockAdjustmentResult,
} from "./stock-writer";
export {
  JUBELIO_OUTBOX_ENTITY_TYPES,
  isJubelioOutboxEntityType,
  type JubelioOutboxEntityType,
} from "./jubelio-outbox";
export {
  STOCK_ADJUSTMENT_SOURCES,
  isStockAdjustmentSource,
  type StockAdjustmentSource,
} from "./stock-adjustment-source";
export {
  recalcItemSellingPrice,
  type RecalcItemSellingPriceInput,
  type RecalcItemSellingPriceResult,
  type RecalcSkipReason,
  type PriceChangeTrigger,
} from "./item-price-writer";
export {
  acceptReturnItem,
  rejectReturnItem,
  submitReturnDecision,
  type AcceptReturnItemInput,
  type AcceptReturnItemResult,
  type RejectReturnItemInput,
  type RejectReturnItemResult,
  type SubmitReturnDecisionInput,
  type SubmitReturnDecisionResult,
} from "./sales-return-writer";

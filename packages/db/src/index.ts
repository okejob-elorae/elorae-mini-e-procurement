import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "./db-connection";

const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);

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
  }
  return globalForPrisma.prisma;
}

export const prisma = getPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaStamp = SCHEMA_STAMP;
}

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

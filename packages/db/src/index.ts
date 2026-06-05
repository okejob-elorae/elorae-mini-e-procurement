import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "./db-connection";

const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Delegate that must exist after Plan Kerja schema; used to detect stale dev singletons. */
function hasPlanningDelegates(client: PrismaClient): boolean {
  return typeof (client as PrismaClient & { planYear?: unknown }).planYear !== "undefined";
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && !hasPlanningDelegates(cached)) {
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

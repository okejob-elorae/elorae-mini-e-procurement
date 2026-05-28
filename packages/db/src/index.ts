import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "./db-connection";

const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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

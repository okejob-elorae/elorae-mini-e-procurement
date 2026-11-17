import type { AnyViraTool, ParityCase, ViraTool, ViraWriteTool } from "./types";
import * as whoami from "./whoami";
import * as items from "./items";
import * as inventory from "./inventory";
import * as stores from "./stores";
import * as storeStocktakes from "./store-stocktakes";
import * as salesOrders from "./sales-orders";
import * as fieldSalesOrders from "./field-sales-orders";
import * as purchaseOrders from "./purchase-orders";
import * as production from "./production";
import * as receivables from "./receivables";
import * as konsinyasi from "./konsinyasi";
import * as taxInvoices from "./tax-invoices";
import * as settlements from "./settlements";
import * as izin from "./izin";
import * as returSpg from "./retur-spg";

type ViraToolModule = {
  tools: ViraTool[];
  parityCases: ParityCase[];
  writeTools?: ViraWriteTool[];
};

const MODULES: ViraToolModule[] = [
  whoami,
  items,
  inventory,
  stores,
  storeStocktakes,
  salesOrders,
  fieldSalesOrders,
  purchaseOrders,
  production,
  receivables,
  konsinyasi,
  taxInvoices,
  settlements,
  izin,
  returSpg,
];

/** Throws if two tools share a name. Run at import time on read ∪ write. */
export function assertUniqueToolNames(tools: readonly { name: string }[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`[vira] duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
}

/** whoami first, then the modules in registry order. Read tools only. */
export const VIRA_TOOLS: ViraTool[] = MODULES.flatMap((m) => m.tools);

/** Write tools from modules that export `writeTools` (none in wave 1). */
export const VIRA_WRITE_TOOLS: ViraWriteTool[] = MODULES.flatMap((m) => m.writeTools ?? []);

/** Concatenation of every module's parityCases. */
export const VIRA_PARITY_CASES: ParityCase[] = MODULES.flatMap((m) => m.parityCases);

export function findWriteTool(name: string): ViraWriteTool | undefined {
  return VIRA_WRITE_TOOLS.find((t) => t.name === name);
}

assertUniqueToolNames([...VIRA_TOOLS, ...VIRA_WRITE_TOOLS] as AnyViraTool[]);

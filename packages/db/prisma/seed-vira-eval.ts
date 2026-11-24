/**
 * Controlled VIRA eval fixtures (local test bed only).
 *
 * Idempotent: deletes rows this seed owns (EVAL- / @vira-eval.local), then re-inserts.
 * Deterministic: fixed doc numbers + dates relative to ANCHOR (2026-11-20 WIB).
 *
 * Run: VIRA_EVAL_PASSWORD=… pnpm -F @elorae/db seed:vira-eval
 *
 * Raw Prisma inserts: users/roles/stores/orders/receivables/POs/leave/SPG returns/
 * tax invoices/consignment cycles (no @elorae/db writers). Stock qty via moveMainStock /
 * moveStoreStock / moveVanStock.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { createDbAdapter } from "../src/adapter";
import {
  PrismaClient,
  Role,
  type Prisma,
} from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";
import { moveMainStock, moveStoreStock, moveVanStock } from "../src/stock-balance";

loadDbEnv();

const databaseUrl = getDatabaseUrl() || process.env.DATABASE_URL || "";
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
assertLocalOnly(databaseUrl);

const adapter = createDbAdapter(databaseUrl);
const prisma = new PrismaClient({ adapter });

/** Fixed "today" for all relative dates (WIB midnight). */
export const ANCHOR = new Date("2026-11-20T00:00:00.000+07:00");

const PREFIX = "EVAL-";
const EMAIL_SUFFIX = "@vira-eval.local";

const IDS = {
  roleAdmin: "eval_role_admin",
  roleStaff: "eval_role_staff",
  roleSalesMgr: "eval_role_sales_mgr",
  userAdmin: "eval_user_admin",
  userStaff: "eval_user_staff",
  userSalesMgr: "eval_user_sales_mgr",
  userSalesman: "eval_user_salesman",
  userSpg: "eval_user_spg",
  supplier: "eval_supplier_01",
  storeCleanKonsi1: "eval_store_clean_k1",
  storeCleanKonsi2: "eval_store_clean_k2",
  storeCleanPutus: "eval_store_clean_p1",
  storeOverLimit: "eval_store_over_limit",
  storeCreditHold: "eval_store_credit_hold",
  storeOverdueOk: "eval_store_overdue_ok",
  storeStock: "eval_store_stock_k",
  storeTax: "eval_store_tax_p",
  storeCycle: "eval_store_cycle_k",
} as const;

const USERS = {
  admin: {
    email: `eval-admin${EMAIL_SUFFIX}`,
    name: "EVAL Admin",
    id: IDS.userAdmin,
  },
  staff: {
    email: `eval-staff${EMAIL_SUFFIX}`,
    name: "EVAL Staff",
    id: IDS.userStaff,
  },
  salesMgr: {
    email: `eval-sales-mgr${EMAIL_SUFFIX}`,
    name: "EVAL Sales Manager",
    id: IDS.userSalesMgr,
  },
  salesman: {
    email: `eval-salesman${EMAIL_SUFFIX}`,
    name: "EVAL Salesman",
    id: IDS.userSalesman,
  },
  spg: {
    email: `eval-spg${EMAIL_SUFFIX}`,
    name: "EVAL SPG",
    id: IDS.userSpg,
  },
} as const;

const DOC = {
  orderCleanKonsi1: "EVAL-SO-KONSI-001",
  orderCleanKonsi2: "EVAL-SO-KONSI-002",
  orderCleanPutus: "EVAL-SO-PUTUS-001",
  orderOverLimit: "EVAL-SO-PUTUS-OVER",
  orderCreditHold: "EVAL-SO-PUTUS-HOLD",
  orderOverdueOk: "EVAL-SO-PUTUS-ODUE",
  orderTaxCreated: "EVAL-SO-PUTUS-TAX1",
  orderTaxSent: "EVAL-SO-PUTUS-TAX2",
  deliveryTaxCreated: "EVAL-DLV-TAX-001",
  deliveryTaxSent: "EVAL-DLV-TAX-002",
  recvOverLimit: "EVAL-INV-OVER-LIMIT",
  recvHoldOverdue: "EVAL-INV-HOLD-ODUE",
  recvHoldCurrent: "EVAL-INV-HOLD-CUR",
  recvOverdueOk: "EVAL-INV-ODUE-OK",
  recvOverdueOkCur: "EVAL-INV-ODUE-CUR",
  recvCleanPutus: "EVAL-INV-CLEAN-P1",
  poPartial: "EVAL-PO-PARTIAL-01",
  poOverdue: "EVAL-PO-OVERDUE-01",
  poClosed: "EVAL-PO-CLOSED-01",
  leave1: "EVAL-IZIN-001",
  leave2: "EVAL-IZIN-002",
  spgSale1: "EVAL-SPG-SALE-001",
  spgSale2: "EVAL-SPG-SALE-002",
  spgRet1: "EVAL-SPG-RET-001",
  spgRet2: "EVAL-SPG-RET-002",
  taxCreated: "EVAL-FAKTUR-CREATED",
  taxSent: "EVAL-FAKTUR-SENT",
  cycleMissingNota: "EVAL-KONSI-2026-10",
  supplierCode: "EVAL-SUP-01",
} as const;

/** Work orders per status; the manifest counts come from this list. */
const WORK_ORDERS = [
  { docNumber: "EVAL-WO-01", status: "ISSUED", plannedQty: 100 },
  { docNumber: "EVAL-WO-02", status: "IN_PRODUCTION", plannedQty: 60 },
  { docNumber: "EVAL-WO-03", status: "IN_PRODUCTION", plannedQty: 40 },
  { docNumber: "EVAL-WO-04", status: "COMPLETED", plannedQty: 25 },
] as const;
const OPEN_WORK_ORDERS = WORK_ORDERS.filter((w) => w.status !== "COMPLETED");

const MONEY = {
  cleanPutusTotal: 750_000,
  overLimitRecv: 5_000_000,
  overLimitOrder: 800_000,
  overLimitCredit: 1_000_000,
  holdOverdueRecv: 2_500_000,
  holdCurrentRecv: 400_000,
  holdCredit: 10_000_000,
  overdueOkRecv: 300_000,
  overdueOkCurrent: 150_000,
  overdueOkCredit: 5_000_000,
  overdueOkOrder: 200_000,
  taxDeliveryTotal: 1_100_000,
  unitPrice: 75_000,
  poLinePrice: 50_000,
  stockUnitCost: 40_000,
} as const;

const STAFF_PERMS = [
  "vira:use",
  "dashboard:view",
  "items:view",
  "inventory:view",
  "stores:view",
  "sales_orders:view",
  "field_sales_orders:view",
  "purchase_orders:view",
  "work_orders:view",
  "receivables:view",
  "tax_invoices:view",
  "finance:settlements:view",
  "spg_sales:view",
  "consignment:view",
  "suppliers:view",
] as const;

const SALES_MGR_PERMS = [
  "vira:use",
  "vira:write",
  "field_sales_orders:view",
  "field_sales_orders:approve",
  "receivables:view",
  "stores:view",
  "items:view",
  "spg_sales:view",
  "spg_returns:approve",
] as const;

type ItemSeed = {
  id: string;
  sku: string;
  name: string;
  mainQty: number;
  vanQty: number;
  storeQty: number;
};

const ITEMS: ItemSeed[] = [
  { id: "eval_item_01", sku: "EVAL-SKU-01", name: "EVAL Blouse Mira Soft", mainQty: 40, vanQty: 5, storeQty: 8 },
  { id: "eval_item_02", sku: "EVAL-SKU-02", name: "EVAL Blouse Mira Soft Pink", mainQty: 35, vanQty: 4, storeQty: 6 },
  { id: "eval_item_03", sku: "EVAL-SKU-03", name: "EVAL Dress Luna A", mainQty: 20, vanQty: 3, storeQty: 5 },
  { id: "eval_item_04", sku: "EVAL-SKU-04", name: "EVAL Dress Luna B", mainQty: 18, vanQty: 2, storeQty: 4 },
  { id: "eval_item_05", sku: "EVAL-SKU-05", name: "EVAL Skirt Nova", mainQty: 50, vanQty: 6, storeQty: 10 },
  { id: "eval_item_06", sku: "EVAL-SKU-06", name: "EVAL Top Sari", mainQty: 25, vanQty: 3, storeQty: 7 },
  { id: "eval_item_07", sku: "EVAL-SKU-07", name: "EVAL Jacket Raya", mainQty: 12, vanQty: 2, storeQty: 3 },
  { id: "eval_item_08", sku: "EVAL-SKU-08", name: "EVAL Pants Kota", mainQty: 30, vanQty: 4, storeQty: 9 },
  { id: "eval_item_09", sku: "EVAL-SKU-09", name: "EVAL Set Anggun", mainQty: 15, vanQty: 2, storeQty: 4 },
  { id: "eval_item_10", sku: "EVAL-SKU-10", name: "EVAL Outer Bambu", mainQty: 22, vanQty: 3, storeQty: 5 },
  { id: "eval_item_11", sku: "EVAL-SKU-11", name: "EVAL Tunik Melati", mainQty: 28, vanQty: 4, storeQty: 6 },
  { id: "eval_item_12", sku: "EVAL-SKU-12", name: "EVAL Kemeja Pagi", mainQty: 16, vanQty: 2, storeQty: 3 },
  { id: "eval_item_13", sku: "EVAL-SKU-13", name: "EVAL Celana Malam", mainQty: 19, vanQty: 3, storeQty: 4 },
  { id: "eval_item_14", sku: "EVAL-SKU-14", name: "EVAL Zero Stock Item", mainQty: 0, vanQty: 0, storeQty: 0 },
  { id: "eval_item_15", sku: "EVAL-SKU-15", name: "EVAL Ambiguous Twin Alpha", mainQty: 10, vanQty: 1, storeQty: 2 },
  { id: "eval_item_16", sku: "EVAL-SKU-16", name: "EVAL Ambiguous Twin Alfa", mainQty: 11, vanQty: 1, storeQty: 2 },
];

function assertLocalOnly(url: string): void {
  if (url.includes(":3307") || /prod/i.test(url)) {
    throw new Error(
      `Refusing to run seed-vira-eval against non-local URL host. Expected :3308 test bed, got: ${redactUrl(url)}`,
    );
  }
  let host = "";
  try {
    host = new URL(url.replace(/^mysql:/i, "http:").replace(/^mariadb:/i, "http:")).host;
  } catch {
    host = url;
  }
  if (!host.includes("127.0.0.1:3308") && !host.includes("localhost:3308")) {
    throw new Error(
      `Refusing to run seed-vira-eval — DATABASE_URL must be 127.0.0.1:3308 (got ${host}).`,
    );
  }
}

function redactUrl(url: string): string {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

function daysFromAnchor(days: number): Date {
  return new Date(ANCHOR.getTime() + days * 86_400_000);
}

function wibDay(daysFromAnchorOffset: number): string {
  const d = daysFromAnchor(daysFromAnchorOffset);
  const wib = new Date(d.getTime() + 7 * 3600_000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const day = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function countEvalOwned(client: PrismaClient) {
  const [
    stores,
    orders,
    items,
    pos,
    leaves,
    returns,
    cycles,
    users,
    receivables,
    workOrders,
  ] = await Promise.all([
    client.store.count({ where: { code: { startsWith: PREFIX } } }),
    client.fieldSalesOrder.count({ where: { orderNo: { startsWith: PREFIX } } }),
    client.item.count({ where: { sku: { startsWith: PREFIX } } }),
    client.purchaseOrder.count({ where: { docNumber: { startsWith: PREFIX } } }),
    client.leaveRequest.count({ where: { reason: { startsWith: PREFIX } } }),
    client.spgSaleReturn.count({ where: { idempotencyKey: { startsWith: PREFIX } } }),
    client.consignmentCycle.count({ where: { noKonsi: { startsWith: PREFIX } } }),
    client.user.count({ where: { email: { endsWith: EMAIL_SUFFIX } } }),
    client.receivable.count({ where: { invoiceNo: { startsWith: PREFIX } } }),
    client.workOrder.count({ where: { docNumber: { startsWith: PREFIX } } }),
  ]);
  return {
    stores,
    orders,
    items,
    pos,
    leaves,
    returns,
    cycles,
    users,
    receivables,
    workOrders,
  };
}

async function cleanup(tx: Prisma.TransactionClient): Promise<void> {
  const evalUsers = await tx.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const userIds = evalUsers.map((u) => u.id);

  const evalStores = await tx.store.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = evalStores.map((s) => s.id);

  const evalItems = await tx.item.findMany({
    where: { sku: { startsWith: PREFIX } },
    select: { id: true },
  });
  const itemIds = evalItems.map((i) => i.id);

  const evalOrders = await tx.fieldSalesOrder.findMany({
    where: {
      OR: [
        { orderNo: { startsWith: PREFIX } },
        { storeId: { in: storeIds.length ? storeIds : ["__none__"] } },
      ],
    },
    select: { id: true },
  });
  const orderIds = evalOrders.map((o) => o.id);

  const deliveries = await tx.fieldSalesDelivery.findMany({
    where: {
      OR: [
        { docNo: { startsWith: PREFIX } },
        { orderId: { in: orderIds.length ? orderIds : ["__none__"] } },
      ],
    },
    select: { id: true },
  });
  const deliveryIds = deliveries.map((d) => d.id);

  const cycles = await tx.consignmentCycle.findMany({
    where: { noKonsi: { startsWith: PREFIX } },
    select: { id: true },
  });
  const cycleIds = cycles.map((c) => c.id);

  const spgSales = await tx.spgSale.findMany({
    where: { docNo: { startsWith: PREFIX } },
    select: { id: true },
  });
  const spgSaleIds = spgSales.map((s) => s.id);

  const returns = await tx.spgSaleReturn.findMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: PREFIX } },
        { spgSaleId: { in: spgSaleIds.length ? spgSaleIds : ["__none__"] } },
      ],
    },
    select: { id: true },
  });
  const returnIds = returns.map((r) => r.id);

  const pos = await tx.purchaseOrder.findMany({
    where: { docNumber: { startsWith: PREFIX } },
    select: { id: true },
  });
  const poIds = pos.map((p) => p.id);

  if (returnIds.length) {
    await tx.spgSaleReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await tx.spgSaleReturn.deleteMany({ where: { id: { in: returnIds } } });
  }
  if (spgSaleIds.length) {
    await tx.spgSaleLine.deleteMany({ where: { spgSaleId: { in: spgSaleIds } } });
    await tx.spgSale.deleteMany({ where: { id: { in: spgSaleIds } } });
  }

  if (userIds.length) {
    await tx.leaveRequest.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { reason: { startsWith: PREFIX } }],
      },
    });
  } else {
    await tx.leaveRequest.deleteMany({ where: { reason: { startsWith: PREFIX } } });
  }

  if (deliveryIds.length) {
    await tx.taxInvoice.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await tx.receivable.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await tx.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await tx.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
  }

  await tx.receivable.deleteMany({
    where: {
      OR: [
        { invoiceNo: { startsWith: PREFIX } },
        { storeId: { in: storeIds.length ? storeIds : ["__none__"] } },
        { consignmentCycleId: { in: cycleIds.length ? cycleIds : ["__none__"] } },
      ],
    },
  });

  if (orderIds.length) {
    await tx.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  if (cycleIds.length) {
    await tx.consignmentReport.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await tx.consignmentShipment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await tx.consignmentCycle.deleteMany({ where: { id: { in: cycleIds } } });
  }

  await tx.workOrder.deleteMany({ where: { docNumber: { startsWith: PREFIX } } });

  if (poIds.length) {
    await tx.pOStatusHistory.deleteMany({ where: { poId: { in: poIds } } });
    await tx.pOItem.deleteMany({ where: { poId: { in: poIds } } });
    await tx.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  }

  if (itemIds.length) {
    await tx.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await tx.storeStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await tx.vanStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await tx.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await tx.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  if (storeIds.length) {
    await tx.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await tx.store.deleteMany({ where: { id: { in: storeIds } } });
  }

  await tx.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });

  if (userIds.length) {
    await tx.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await tx.account.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  }

  const evalRoles = await tx.roleDefinition.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const roleIds = evalRoles.map((r) => r.id);
  if (roleIds.length) {
    await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await tx.roleDefinition.deleteMany({ where: { id: { in: roleIds } } });
  }
}

async function ensurePermission(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<string> {
  const [moduleName, action] = code.split(":");
  const row = await tx.permission.upsert({
    where: { code },
    update: {},
    create: {
      code,
      module: moduleName || "misc",
      action: action || "view",
      description: `EVAL seed: ${code}`,
    },
    select: { id: true },
  });
  return row.id;
}

async function createRoleWithPerms(
  tx: Prisma.TransactionClient,
  opts: {
    id: string;
    name: string;
    description: string;
    isSystem: boolean;
    codes: readonly string[];
  },
): Promise<string> {
  await tx.roleDefinition.create({
    data: {
      id: opts.id,
      name: opts.name,
      description: opts.description,
      isSystem: opts.isSystem,
    },
  });
  for (const code of opts.codes) {
    const permissionId = await ensurePermission(tx, code);
    await tx.rolePermission.create({
      data: { roleId: opts.id, permissionId },
    });
  }
  return opts.id;
}

async function createUser(
  tx: Prisma.TransactionClient,
  opts: {
    id: string;
    email: string;
    name: string;
    roleId: string;
    passwordHash: string;
    pinHash: string;
    role: Role;
    assignedStoreId?: string;
  },
): Promise<void> {
  await tx.user.create({
    data: {
      id: opts.id,
      email: opts.email,
      name: opts.name,
      passwordHash: opts.passwordHash,
      pinHash: opts.pinHash,
      role: opts.role,
      roleId: opts.roleId,
      assignedStoreId: opts.assignedStoreId,
    },
  });
}

function receivableBoth(amount: number) {
  return {
    originalAmount: amount,
    paidAmount: 0,
    outstandingAmount: amount,
    amount,
    outstanding: amount,
  };
}

async function main() {
  const password = process.env.VIRA_EVAL_PASSWORD;
  if (!password || password.length < 6) {
    throw new Error("Set VIRA_EVAL_PASSWORD (min 6 chars). Never commit it.");
  }

  console.log("VIRA eval seed");
  console.log(`  target: ${redactUrl(databaseUrl)}`);
  console.log(`  anchor: ${ANCHOR.toISOString()} (WIB 2026-11-20)`);

  const before = await countEvalOwned(prisma);
  console.log("  before:", before);

  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = await bcrypt.hash("123456", 10);

  const uom = await prisma.uOM.findFirst({
    where: { code: "PCS" },
    select: { id: true },
  });
  if (!uom) throw new Error("UOM PCS missing — run a base seed first.");

  let supplierTypeId =
    (
      await prisma.supplierType.findFirst({
        where: { code: "FABRIC" },
        select: { id: true },
      })
    )?.id ?? null;
  if (!supplierTypeId) {
    const anyType = await prisma.supplierType.findFirst({ select: { id: true } });
    supplierTypeId = anyType?.id ?? null;
  }
  if (!supplierTypeId) throw new Error("No SupplierType — run a base seed first.");

  await prisma.$transaction(
    async (tx) => {
      await cleanup(tx);

      await createRoleWithPerms(tx, {
        id: IDS.roleAdmin,
        name: "EVAL-ADMIN",
        description: "VIRA eval admin (system wildcard)",
        isSystem: true,
        codes: ["vira:use", "vira:write"],
      });
      await createRoleWithPerms(tx, {
        id: IDS.roleStaff,
        name: "EVAL-STAFF",
        description: "VIRA eval staff — view + vira:use, no write/approve",
        isSystem: false,
        codes: STAFF_PERMS,
      });
      await createRoleWithPerms(tx, {
        id: IDS.roleSalesMgr,
        name: "EVAL-SALES-MGR",
        description: "VIRA eval sales manager — approve field sales + vira write",
        isSystem: false,
        codes: SALES_MGR_PERMS,
      });

      await createUser(tx, {
        id: USERS.admin.id,
        email: USERS.admin.email,
        name: USERS.admin.name,
        roleId: IDS.roleAdmin,
        passwordHash,
        pinHash,
        role: Role.ADMIN,
      });
      await createUser(tx, {
        id: USERS.staff.id,
        email: USERS.staff.email,
        name: USERS.staff.name,
        roleId: IDS.roleStaff,
        passwordHash,
        pinHash,
        role: Role.USER,
      });
      await createUser(tx, {
        id: USERS.salesMgr.id,
        email: USERS.salesMgr.email,
        name: USERS.salesMgr.name,
        roleId: IDS.roleSalesMgr,
        passwordHash,
        pinHash,
        role: Role.USER,
      });
      await createUser(tx, {
        id: USERS.salesman.id,
        email: USERS.salesman.email,
        name: USERS.salesman.name,
        roleId: IDS.roleStaff,
        passwordHash,
        pinHash,
        role: Role.USER,
      });
      await createUser(tx, {
        id: USERS.spg.id,
        email: USERS.spg.email,
        name: USERS.spg.name,
        roleId: IDS.roleStaff,
        passwordHash,
        pinHash,
        role: Role.USER,
      });

      await tx.supplier.create({
        data: {
          id: IDS.supplier,
          code: DOC.supplierCode,
          name: "EVAL Supplier Kain",
          typeId: supplierTypeId!,
          isActive: true,
          status: "ACTIVE",
          email: `supplier${EMAIL_SUFFIX}`,
          phone: "08000000001",
          address: "EVAL supplier address",
        },
      });

      for (const it of ITEMS) {
        await tx.item.create({
          data: {
            id: it.id,
            sku: it.sku,
            nameId: it.name,
            nameEn: it.name,
            type: "FINISHED_GOOD",
            uomId: uom.id,
            isActive: true,
            sellingPrice: MONEY.unitPrice,
            salesChannel: "OFFLINE",
            source: "ERP",
          },
        });
      }

      const stockStores = [
        {
          id: IDS.storeCleanKonsi1,
          code: "EVAL-ST-CK1",
          name: "EVAL Toko Bersih Konsi 1",
          termsType: "KONSI" as const,
          creditLimit: null as number | null,
          noCreditLimit: true,
        },
        {
          id: IDS.storeCleanKonsi2,
          code: "EVAL-ST-CK2",
          name: "EVAL Toko Bersih Konsi 2",
          termsType: "KONSI" as const,
          creditLimit: null,
          noCreditLimit: true,
        },
        {
          id: IDS.storeCleanPutus,
          code: "EVAL-ST-CP1",
          name: "EVAL Toko Bersih Putus",
          termsType: "PUTUS" as const,
          creditLimit: 20_000_000,
          noCreditLimit: false,
        },
        {
          id: IDS.storeOverLimit,
          code: "EVAL-ST-OVER",
          name: "EVAL Toko Lewat Batas Kredit",
          termsType: "PUTUS" as const,
          creditLimit: MONEY.overLimitCredit,
          noCreditLimit: false,
        },
        {
          id: IDS.storeCreditHold,
          code: "EVAL-ST-HOLD",
          name: "EVAL Toko Tahan Kredit",
          termsType: "PUTUS" as const,
          creditLimit: MONEY.holdCredit,
          noCreditLimit: false,
        },
        {
          id: IDS.storeOverdueOk,
          code: "EVAL-ST-ODUE",
          name: "EVAL Toko Jatuh Tempo Masih Aman",
          termsType: "PUTUS" as const,
          creditLimit: MONEY.overdueOkCredit,
          noCreditLimit: false,
        },
        {
          id: IDS.storeStock,
          code: "EVAL-ST-STOCK",
          name: "EVAL Toko Stok Konsi",
          termsType: "KONSI" as const,
          creditLimit: null,
          noCreditLimit: true,
        },
        {
          id: IDS.storeTax,
          code: "EVAL-ST-TAX",
          name: "EVAL Toko Faktur Pajak",
          termsType: "PUTUS" as const,
          creditLimit: 50_000_000,
          noCreditLimit: false,
        },
        {
          id: IDS.storeCycle,
          code: "EVAL-ST-CYCLE",
          name: "EVAL Toko Siklus Tanpa Nota",
          termsType: "KONSI" as const,
          creditLimit: null,
          noCreditLimit: true,
        },
      ];

      for (const s of stockStores) {
        await tx.store.create({
          data: {
            id: s.id,
            code: s.code,
            name: s.name,
            address: `${s.name} address`,
            termsType: s.termsType,
            creditLimit: s.creditLimit,
            noCreditLimit: s.noCreditLimit,
            paymentTempo: 30,
            isActive: true,
            salesmanId: USERS.salesman.id,
            npwp: s.id === IDS.storeTax ? "10.0.0.1-000.000" : null,
          },
        });
      }

      await tx.user.update({
        where: { id: USERS.spg.id },
        data: { assignedStoreId: IDS.storeStock },
      });

      for (const it of ITEMS) {
        if (it.mainQty > 0) {
          await moveMainStock(tx, {
            itemId: it.id,
            variantSku: null,
            qtyDelta: it.mainQty,
            unitCost: MONEY.stockUnitCost,
            avgCost: MONEY.stockUnitCost,
            totalValue: it.mainQty * MONEY.stockUnitCost,
            totalCost: it.mainQty * MONEY.stockUnitCost,
            balanceValue: it.mainQty * MONEY.stockUnitCost,
            refType: "EVAL_SEED",
            refId: `eval-main-${it.id}`,
            refDocNumber: "EVAL-STOCK-MAIN",
            createdById: USERS.admin.id,
            createIfMissing: true,
            occurredAt: ANCHOR,
          });
        }
        if (it.vanQty > 0) {
          await moveVanStock(tx, {
            userId: USERS.salesman.id,
            itemId: it.id,
            variantSku: null,
            qtyDelta: it.vanQty,
            unitCost: MONEY.stockUnitCost,
            avgCost: MONEY.stockUnitCost,
            totalValue: it.vanQty * MONEY.stockUnitCost,
            totalCost: it.vanQty * MONEY.stockUnitCost,
            balanceValue: it.vanQty * MONEY.stockUnitCost,
            refType: "EVAL_SEED",
            refId: `eval-van-${it.id}`,
            refDocNumber: "EVAL-STOCK-VAN",
            createdById: USERS.admin.id,
            occurredAt: ANCHOR,
          });
        }
        if (it.storeQty > 0) {
          await moveStoreStock(tx, {
            storeId: IDS.storeStock,
            itemId: it.id,
            variantSku: null,
            qtyDelta: it.storeQty,
            unitCost: MONEY.stockUnitCost,
            avgCost: MONEY.stockUnitCost,
            totalValue: it.storeQty * MONEY.stockUnitCost,
            totalCost: it.storeQty * MONEY.stockUnitCost,
            balanceValue: it.storeQty * MONEY.stockUnitCost,
            refType: "EVAL_SEED",
            refId: `eval-store-${it.id}`,
            refDocNumber: "EVAL-STOCK-STORE",
            createdById: USERS.admin.id,
            occurredAt: ANCHOR,
          });
        }
      }

      const lineItem = ITEMS[0]!;
      async function createPendingOrder(opts: {
        orderNo: string;
        storeId: string;
        orderType: "KONSI" | "PUTUS";
        total: number;
        kreditDitahan?: boolean;
        creditHoldAtCreate?: boolean;
        note: string;
      }) {
        const qty = Math.max(1, Math.round(opts.total / MONEY.unitPrice));
        const lineTotal = qty * MONEY.unitPrice;
        await tx.fieldSalesOrder.create({
          data: {
            orderNo: opts.orderNo,
            storeId: opts.storeId,
            salesmanId: USERS.salesman.id,
            status: "PENDING_APPROVAL",
            orderType: opts.orderType,
            origin: "FIELD",
            subtotal: lineTotal,
            total: lineTotal,
            kreditDitahan: opts.kreditDitahan ?? false,
            creditHoldAtCreate: opts.creditHoldAtCreate ?? false,
            creditExposureAtCreate: opts.creditHoldAtCreate
              ? MONEY.overLimitRecv
              : undefined,
            creditLimitAtCreate: opts.creditHoldAtCreate
              ? MONEY.overLimitCredit
              : undefined,
            note: opts.note,
            createdAt: daysFromAnchor(-2),
            lines: {
              create: [
                {
                  itemId: lineItem.id,
                  variantSku: "",
                  productName: lineItem.name,
                  qty,
                  unitPrice: MONEY.unitPrice,
                  lineTotal,
                },
              ],
            },
          },
        });
      }

      await createPendingOrder({
        orderNo: DOC.orderCleanKonsi1,
        storeId: IDS.storeCleanKonsi1,
        orderType: "KONSI",
        total: MONEY.unitPrice * 4,
        note: "EVAL clean konsi 1",
      });
      await createPendingOrder({
        orderNo: DOC.orderCleanKonsi2,
        storeId: IDS.storeCleanKonsi2,
        orderType: "KONSI",
        total: MONEY.unitPrice * 3,
        note: "EVAL clean konsi 2",
      });
      await createPendingOrder({
        orderNo: DOC.orderCleanPutus,
        storeId: IDS.storeCleanPutus,
        orderType: "PUTUS",
        total: MONEY.cleanPutusTotal,
        note: "EVAL clean putus",
      });
      await createPendingOrder({
        orderNo: DOC.orderOverLimit,
        storeId: IDS.storeOverLimit,
        orderType: "PUTUS",
        total: MONEY.overLimitOrder,
        creditHoldAtCreate: true,
        note: "EVAL over credit limit",
      });
      await createPendingOrder({
        orderNo: DOC.orderCreditHold,
        storeId: IDS.storeCreditHold,
        orderType: "PUTUS",
        total: MONEY.unitPrice * 2,
        kreditDitahan: true,
        note: "EVAL credit hold (kreditDitahan)",
      });
      await createPendingOrder({
        orderNo: DOC.orderOverdueOk,
        storeId: IDS.storeOverdueOk,
        orderType: "PUTUS",
        total: MONEY.overdueOkOrder,
        note: "EVAL overdue receivable but within limit",
      });

      await tx.receivable.create({
        data: {
          storeId: IDS.storeOverLimit,
          invoiceNo: DOC.recvOverLimit,
          invoiceDate: daysFromAnchor(-40),
          dueDate: daysFromAnchor(-10),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          isConsignment: false,
          note: "EVAL over-limit exposure",
          ...receivableBoth(MONEY.overLimitRecv),
        },
      });
      await tx.receivable.create({
        data: {
          storeId: IDS.storeCreditHold,
          invoiceNo: DOC.recvHoldOverdue,
          invoiceDate: daysFromAnchor(-45),
          dueDate: daysFromAnchor(-15),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          note: "EVAL hold overdue bill",
          ...receivableBoth(MONEY.holdOverdueRecv),
        },
      });
      await tx.receivable.create({
        data: {
          storeId: IDS.storeCreditHold,
          invoiceNo: DOC.recvHoldCurrent,
          invoiceDate: daysFromAnchor(-5),
          dueDate: daysFromAnchor(25),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          note: "EVAL hold current bill",
          ...receivableBoth(MONEY.holdCurrentRecv),
        },
      });
      await tx.receivable.create({
        data: {
          storeId: IDS.storeOverdueOk,
          invoiceNo: DOC.recvOverdueOk,
          invoiceDate: daysFromAnchor(-35),
          dueDate: daysFromAnchor(-5),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          note: "EVAL overdue within limit",
          ...receivableBoth(MONEY.overdueOkRecv),
        },
      });
      await tx.receivable.create({
        data: {
          storeId: IDS.storeOverdueOk,
          invoiceNo: DOC.recvOverdueOkCur,
          invoiceDate: daysFromAnchor(-3),
          dueDate: daysFromAnchor(27),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          note: "EVAL current within limit",
          ...receivableBoth(MONEY.overdueOkCurrent),
        },
      });
      await tx.receivable.create({
        data: {
          storeId: IDS.storeCleanPutus,
          invoiceNo: DOC.recvCleanPutus,
          invoiceDate: daysFromAnchor(-2),
          dueDate: daysFromAnchor(28),
          status: "OUTSTANDING",
          source: "MANUAL",
          salesmanId: USERS.salesman.id,
          note: "EVAL clean current",
          ...receivableBoth(100_000),
        },
      });

      for (const tax of [
        {
          orderNo: DOC.orderTaxCreated,
          deliveryNo: DOC.deliveryTaxCreated,
          invoiceNo: DOC.taxCreated,
          status: "CREATED" as const,
          markedAt: daysFromAnchor(-1),
        },
        {
          orderNo: DOC.orderTaxSent,
          deliveryNo: DOC.deliveryTaxSent,
          invoiceNo: DOC.taxSent,
          status: "SENT_TO_STORE" as const,
          markedAt: daysFromAnchor(-3),
        },
      ]) {
        const qty = Math.round(MONEY.taxDeliveryTotal / MONEY.unitPrice);
        const lineTotal = qty * MONEY.unitPrice;
        const order = await tx.fieldSalesOrder.create({
          data: {
            orderNo: tax.orderNo,
            storeId: IDS.storeTax,
            salesmanId: USERS.salesman.id,
            status: "APPROVED",
            deliveryStatus: "DELIVERED",
            orderType: "PUTUS",
            origin: "ADMIN",
            subtotal: lineTotal,
            total: lineTotal,
            approvedAt: daysFromAnchor(-7),
            approvedById: USERS.admin.id,
            createdAt: daysFromAnchor(-8),
            lines: {
              create: [
                {
                  itemId: lineItem.id,
                  variantSku: "",
                  productName: lineItem.name,
                  qty,
                  unitPrice: MONEY.unitPrice,
                  lineTotal,
                },
              ],
            },
          },
          include: { lines: true },
        });
        const orderLine = order.lines[0]!;
        const delivery = await tx.fieldSalesDelivery.create({
          data: {
            docNo: tax.deliveryNo,
            orderId: order.id,
            deliveredAt: daysFromAnchor(-6),
            deliveredById: USERS.salesman.id,
            invoiceDate: daysFromAnchor(-6),
            dueDate: daysFromAnchor(24),
            subtotal: lineTotal,
            total: lineTotal,
            lines: {
              create: [
                {
                  orderLineId: orderLine.id,
                  itemId: lineItem.id,
                  variantSku: "",
                  productName: lineItem.name,
                  qty,
                  unitPrice: MONEY.unitPrice,
                  lineTotal,
                },
              ],
            },
          },
        });
        await tx.taxInvoice.create({
          data: {
            deliveryId: delivery.id,
            status: tax.status,
            invoiceNo: tax.invoiceNo,
            markedAt: tax.markedAt,
            markedById: USERS.admin.id,
            buyerNpwp: "10.0.0.1-000.000",
            taxableAmount: Math.round(lineTotal / 1.11),
            ppnAmount: lineTotal - Math.round(lineTotal / 1.11),
          },
        });
      }

      for (const w of WORK_ORDERS) {
        await tx.workOrder.create({
          data: {
            docNumber: w.docNumber,
            status: w.status,
            vendorId: IDS.supplier,
            finishedGoodId: ITEMS[0]!.id,
            plannedQty: w.plannedQty,
            consumptionPlan: [],
            createdById: USERS.admin.id,
            createdAt: daysFromAnchor(-15),
          },
        });
      }

      const poItem = ITEMS[4]!;
      await tx.purchaseOrder.create({
        data: {
          docNumber: DOC.poPartial,
          supplierId: IDS.supplier,
          status: "PARTIAL",
          etaDate: daysFromAnchor(10),
          createdById: USERS.admin.id,
          totalAmount: MONEY.poLinePrice * 100,
          grandTotal: MONEY.poLinePrice * 100,
          notes: "EVAL PARTIAL closable",
          createdAt: daysFromAnchor(-20),
          items: {
            create: [
              {
                itemId: poItem.id,
                qty: 100,
                price: MONEY.poLinePrice,
                receivedQty: 40,
                uomId: uom.id,
              },
            ],
          },
        },
      });
      await tx.purchaseOrder.create({
        data: {
          docNumber: DOC.poOverdue,
          supplierId: IDS.supplier,
          status: "SUBMITTED",
          etaDate: daysFromAnchor(-5),
          createdById: USERS.admin.id,
          totalAmount: MONEY.poLinePrice * 50,
          grandTotal: MONEY.poLinePrice * 50,
          notes: "EVAL overdue (SUBMITTED + past eta)",
          createdAt: daysFromAnchor(-30),
          items: {
            create: [
              {
                itemId: poItem.id,
                qty: 50,
                price: MONEY.poLinePrice,
                receivedQty: 0,
                uomId: uom.id,
              },
            ],
          },
        },
      });
      await tx.purchaseOrder.create({
        data: {
          docNumber: DOC.poClosed,
          supplierId: IDS.supplier,
          status: "CLOSED",
          etaDate: daysFromAnchor(-40),
          closedAt: daysFromAnchor(-10),
          closedById: USERS.admin.id,
          createdById: USERS.admin.id,
          totalAmount: MONEY.poLinePrice * 20,
          grandTotal: MONEY.poLinePrice * 20,
          notes: "EVAL completed (CLOSED)",
          createdAt: daysFromAnchor(-50),
          items: {
            create: [
              {
                itemId: poItem.id,
                qty: 20,
                price: MONEY.poLinePrice,
                receivedQty: 20,
                uomId: uom.id,
              },
            ],
          },
        },
      });

      await tx.leaveRequest.create({
        data: {
          userId: USERS.salesman.id,
          type: "IZIN",
          startDay: wibDay(3),
          endDay: wibDay(3),
          reason: `${DOC.leave1} keperluan keluarga`,
          status: "DIAJUKAN",
          idempotencyKey: DOC.leave1,
          createdAt: daysFromAnchor(-1),
        },
      });
      await tx.leaveRequest.create({
        data: {
          userId: USERS.salesman.id,
          type: "SAKIT",
          startDay: wibDay(5),
          endDay: wibDay(6),
          reason: `${DOC.leave2} sakit`,
          status: "DIAJUKAN",
          idempotencyKey: DOC.leave2,
          createdAt: daysFromAnchor(-1),
        },
      });

      for (const ret of [
        { saleNo: DOC.spgSale1, retKey: DOC.spgRet1, qty: 1 },
        { saleNo: DOC.spgSale2, retKey: DOC.spgRet2, qty: 2 },
      ]) {
        const sale = await tx.spgSale.create({
          data: {
            docNo: ret.saleNo,
            salesmanId: USERS.spg.id,
            storeId: IDS.storeStock,
            subtotal: MONEY.unitPrice * 3,
            total: MONEY.unitPrice * 3,
            cashReceived: MONEY.unitPrice * 3,
            changeGiven: 0,
            createdById: USERS.spg.id,
            createdAt: daysFromAnchor(-4),
            lines: {
              create: [
                {
                  itemId: lineItem.id,
                  variantSku: "",
                  productName: lineItem.name,
                  qty: 3,
                  unitPrice: MONEY.unitPrice,
                  lineTotal: MONEY.unitPrice * 3,
                },
              ],
            },
          },
          include: { lines: true },
        });
        const saleLine = sale.lines[0]!;
        await tx.spgSaleReturn.create({
          data: {
            spgSaleId: sale.id,
            storeId: IDS.storeStock,
            createdById: USERS.spg.id,
            reason: `EVAL retur pembeli ${ret.retKey}`,
            idempotencyKey: ret.retKey,
            status: "MENUNGGU",
            createdAt: daysFromAnchor(-1),
            lines: {
              create: [
                {
                  spgSaleLineId: saleLine.id,
                  itemId: lineItem.id,
                  variantSku: "",
                  qty: ret.qty,
                  condition: "LAYAK",
                },
              ],
            },
          },
        });
      }

      await tx.consignmentCycle.create({
        data: {
          noKonsi: DOC.cycleMissingNota,
          storeId: IDS.storeCycle,
          periodYear: 2026,
          periodMonth: 10,
          lockedAt: daysFromAnchor(-12),
          lockedById: USERS.admin.id,
          noNota: null,
          noFakturPajak: null,
          promoBorneByElorae: 0,
          lossChargedToStore: 0,
        },
      });
    },
    { timeout: 120_000 },
  );

  const after = await countEvalOwned(prisma);
  console.log("  after:", after);

  const manifest = buildManifest();
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = join(here, "vira-eval-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`  wrote ${manifestPath} (${manifest.scenarios.length} scenarios)`);
  console.log(
    `  fingerprint: ${createHash("sha256").update(JSON.stringify(manifest.scenarios)).digest("hex").slice(0, 12)}`,
  );
}

function buildManifest() {
  const cleanPutusQty = Math.max(1, Math.round(MONEY.cleanPutusTotal / MONEY.unitPrice));
  const overLimitQty = Math.max(1, Math.round(MONEY.overLimitOrder / MONEY.unitPrice));
  const overdueOkQty = Math.max(1, Math.round(MONEY.overdueOkOrder / MONEY.unitPrice));

  return {
    anchor: "2026-11-20T00:00:00.000+07:00",
    passwordEnv: "VIRA_EVAL_PASSWORD",
    users: {
      admin: USERS.admin.email,
      staff: USERS.staff.email,
      salesMgr: USERS.salesMgr.email,
    },
    limitations: [
      "Schema has one warehouse location type (MAIN / Gudang Utama), plus VAN and STORE — not multiple named warehouses. Seed puts stock on MAIN + VAN + one KONSI store.",
      "PO 'completed' is status CLOSED (no COMPLETED enum). PO 'overdue' is SUBMITTED/PARTIAL with etaDate before today WIB, not a status.",
      "TaxInvoice requires deliveryId or sellThroughId (DB CHECK) — seeded via APPROVED putus deliveries.",
      "Receivable source enum is DELIVERY|IMPORT|MANUAL only; cycle bills use MANUAL/DELIVERY + consignmentCycleId.",
      "Most entities use raw Prisma inserts (no apps/web writers from packages/db). Stock uses moveMainStock/moveStoreStock/moveVanStock.",
    ],
    scenarios: [
      {
        id: "fso-pending-clean",
        loginAs: USERS.salesMgr.email,
        question:
          "Ada berapa pesanan field sales yang menunggu persetujuan dan tidak bermasalah kredit?",
        expectedTools: ["list_field_sales_orders"],
        facts: {
          pendingCleanOrderNos: [
            DOC.orderCleanKonsi1,
            DOC.orderCleanKonsi2,
            DOC.orderCleanPutus,
          ],
          pendingCleanKonsiCount: 2,
          pendingCleanPutusCount: 1,
          cleanPutusTotal: cleanPutusQty * MONEY.unitPrice,
          bermasalah: [
            {
              orderNo: DOC.orderOverLimit,
              why: "Toko lewat batas kredit (creditHoldAtCreate + outstanding piutang besar)",
            },
            {
              orderNo: DOC.orderCreditHold,
              why: "kreditDitahan=true (tahan kredit / overdue bills)",
            },
            {
              orderNo: DOC.orderOverdueOk,
              why: "toko punya piutang jatuh tempo",
            },
          ],
        },
      },
      {
        id: "fso-over-credit-limit",
        loginAs: USERS.salesMgr.email,
        question:
          "Pesanan mana yang toko melebihi batas kredit, dan berapa piutang outstanding toko itu?",
        expectedTools: ["get_field_sales_order_credit", "list_receivables"],
        facts: {
          orderNo: DOC.orderOverLimit,
          storeCode: "EVAL-ST-OVER",
          storeName: "EVAL Toko Lewat Batas Kredit",
          creditLimit: MONEY.overLimitCredit,
          receivableInvoiceNo: DOC.recvOverLimit,
          receivableOutstanding: MONEY.overLimitRecv,
          orderTotal: overLimitQty * MONEY.unitPrice,
          creditHoldAtCreate: true,
          bermasalah: true,
          why: "outstanding piutang + pesanan melebihi creditLimit toko",
        },
      },
      {
        id: "fso-credit-hold",
        loginAs: USERS.salesMgr.email,
        question: "Pesanan mana yang ditahan karena masalah kredit / tagihan jatuh tempo?",
        expectedTools: ["get_field_sales_order_credit"],
        facts: {
          orderNo: DOC.orderCreditHold,
          storeCode: "EVAL-ST-HOLD",
          kreditDitahan: true,
          overdueInvoiceNo: DOC.recvHoldOverdue,
          overdueAmount: MONEY.holdOverdueRecv,
          currentInvoiceNo: DOC.recvHoldCurrent,
          currentAmount: MONEY.holdCurrentRecv,
          bermasalah: true,
          why: "kreditDitahan — VIRA approve harus menolak dan arahkan ke UI",
        },
      },
      {
        id: "fso-overdue-within-limit",
        loginAs: USERS.salesMgr.email,
        question:
          "Toko dengan piutang jatuh tempo tapi masih dalam batas kredit — nomor pesanannya apa? Apakah bermasalah?",
        expectedTools: ["get_field_sales_order_credit", "list_receivables"],
        facts: {
          orderNo: DOC.orderOverdueOk,
          storeCode: "EVAL-ST-ODUE",
          creditLimit: MONEY.overdueOkCredit,
          overdueInvoiceNo: DOC.recvOverdueOk,
          overdueAmount: MONEY.overdueOkRecv,
          currentInvoiceNo: DOC.recvOverdueOkCur,
          currentAmount: MONEY.overdueOkCurrent,
          orderTotal: overdueOkQty * MONEY.unitPrice,
          bermasalah: true,
          reasons: ["overdue_receivables"],
          why: "ada piutang jatuh tempo (bermasalah), meski exposure masih di bawah creditLimit",
        },
      },
      {
        id: "receivables-overdue-and-current",
        loginAs: USERS.admin.email,
        question: "Tampilkan ringkasan piutang EVAL yang jatuh tempo dan yang masih berjalan.",
        expectedTools: ["list_receivables"],
        facts: {
          overdueInvoiceNos: [
            DOC.recvOverLimit,
            DOC.recvHoldOverdue,
            DOC.recvOverdueOk,
          ],
          currentInvoiceNos: [
            DOC.recvHoldCurrent,
            DOC.recvOverdueOkCur,
            DOC.recvCleanPutus,
          ],
          overdueAmounts: {
            [DOC.recvOverLimit]: MONEY.overLimitRecv,
            [DOC.recvHoldOverdue]: MONEY.holdOverdueRecv,
            [DOC.recvOverdueOk]: MONEY.overdueOkRecv,
          },
        },
      },
      {
        id: "items-ambiguous-search",
        loginAs: USERS.staff.email,
        question: "Cari barang 'Ambiguous Twin' — ada berapa hasil mirip?",
        expectedTools: ["search_items"],
        facts: {
          search: "Ambiguous Twin",
          skus: ["EVAL-SKU-15", "EVAL-SKU-16"],
          names: ["EVAL Ambiguous Twin Alpha", "EVAL Ambiguous Twin Alfa"],
          count: 2,
        },
      },
      {
        id: "items-zero-stock",
        loginAs: USERS.staff.email,
        question: "Item EVAL Zero Stock Item stoknya berapa di semua lokasi?",
        expectedTools: ["search_items", "get_item_stock"],
        facts: {
          sku: "EVAL-SKU-14",
          name: "EVAL Zero Stock Item",
          mainQty: 0,
          vanQty: 0,
          storeQty: 0,
        },
      },
      {
        id: "items-stock-locations",
        loginAs: USERS.staff.email,
        question: "Stok EVAL Blouse Mira Soft di gudang utama, van, dan toko konsi?",
        expectedTools: ["search_items", "get_item_stock", "get_store_stock"],
        facts: {
          sku: "EVAL-SKU-01",
          mainQty: 40,
          vanQty: 5,
          storeCode: "EVAL-ST-STOCK",
          storeQty: 8,
          note: "MAIN + VAN + STORE (schema has no second named warehouse)",
        },
      },
      {
        id: "po-partial-closable",
        loginAs: USERS.admin.email,
        question: "PO mana yang PARTIAL dan bisa ditutup?",
        expectedTools: ["list_purchase_orders", "close_purchase_order"],
        facts: {
          docNumber: DOC.poPartial,
          status: "PARTIAL",
          receivedQty: 40,
          orderedQty: 100,
        },
      },
      {
        id: "po-overdue",
        loginAs: USERS.admin.email,
        question: "Ada PO terlambat pengiriman EVAL?",
        expectedTools: ["list_purchase_orders"],
        facts: {
          docNumber: DOC.poOverdue,
          status: "SUBMITTED",
          isOverdue: true,
          etaDate: daysFromAnchor(-5).toISOString(),
        },
      },
      {
        id: "po-completed",
        loginAs: USERS.admin.email,
        question: "PO EVAL yang sudah selesai nomor berapa?",
        expectedTools: ["list_purchase_orders"],
        facts: {
          docNumber: DOC.poClosed,
          status: "CLOSED",
        },
      },
      {
        id: "leave-pending",
        loginAs: USERS.salesMgr.email,
        question: "Ada berapa pengajuan izin salesman yang menunggu?",
        expectedTools: ["list_leave_requests", "approve_leave_request"],
        facts: {
          pendingCount: 2,
          idempotencyKeys: [DOC.leave1, DOC.leave2],
          statuses: ["DIAJUKAN", "DIAJUKAN"],
        },
      },
      {
        id: "spg-returns-pending",
        loginAs: USERS.salesMgr.email,
        question: "Retur pembeli SPG yang menunggu persetujuan ada berapa?",
        expectedTools: ["list_spg_buyer_returns", "approve_spg_buyer_return"],
        facts: {
          pendingCount: 2,
          idempotencyKeys: [DOC.spgRet1, DOC.spgRet2],
          statuses: ["MENUNGGU", "MENUNGGU"],
          saleDocNos: [DOC.spgSale1, DOC.spgSale2],
        },
      },
      {
        id: "tax-invoice-mark-sent",
        loginAs: USERS.admin.email,
        question: "Faktur pajak mana yang sudah CREATED dan bisa ditandai dikirim ke toko?",
        expectedTools: ["list_tax_invoices", "mark_tax_invoice_sent_to_store"],
        facts: {
          createdInvoiceNo: DOC.taxCreated,
          createdStatus: "CREATED",
          sentInvoiceNo: DOC.taxSent,
          sentStatus: "SENT_TO_STORE",
          deliveryNos: [DOC.deliveryTaxCreated, DOC.deliveryTaxSent],
        },
      },
      {
        id: "consignment-missing-nota",
        loginAs: USERS.admin.email,
        question: "Siklus konsinyasi mana yang belum punya nomor NOTA?",
        expectedTools: [
          "list_consignment_cycles",
          "record_consignment_document_number",
        ],
        facts: {
          noKonsi: DOC.cycleMissingNota,
          periodYear: 2026,
          periodMonth: 10,
          noNota: null,
          storeCode: "EVAL-ST-CYCLE",
        },
      },
      {
        id: "generic-po-count-by-supplier",
        loginAs: USERS.admin.email,
        question: "Berapa PO EVAL per pemasok bulan ini (atau semua EVAL-PO)?",
        expectedTools: ["list_entities", "aggregate_entity"],
        facts: {
          entity: "purchase_order",
          supplierCode: DOC.supplierCode,
          poCount: 3,
          byStatus: { PARTIAL: 1, SUBMITTED: 1, CLOSED: 1 },
          docNumbers: [DOC.poPartial, DOC.poOverdue, DOC.poClosed],
        },
      },
      {
        id: "generic-item-stock-across-locations",
        loginAs: USERS.staff.email,
        question: "Stok EVAL-SKU-01 di gudang utama dan toko konsi?",
        expectedTools: ["query_entity"],
        facts: {
          sku: "EVAL-SKU-01",
          itemId: "eval_item_01",
          mainQty: 40,
          storeCode: "EVAL-ST-STOCK",
          storeQty: 8,
          entities: ["inventory_value", "store_stock"],
        },
      },
      {
        id: "generic-receivables-total-per-store",
        loginAs: USERS.admin.email,
        question: "Jumlah outstanding piutang EVAL per toko?",
        expectedTools: ["aggregate_entity"],
        facts: {
          entity: "receivable",
          totalsByStoreCode: {
            "EVAL-ST-OVER": MONEY.overLimitRecv,
            "EVAL-ST-HOLD": MONEY.holdOverdueRecv + MONEY.holdCurrentRecv,
            "EVAL-ST-ODUE": MONEY.overdueOkRecv + MONEY.overdueOkCurrent,
            "EVAL-ST-CP1": 100_000,
          },
        },
      },
      {
        id: "generic-open-work-orders-by-status",
        loginAs: USERS.admin.email,
        question: "Dari SPK EVAL-WO, ada berapa yang masih terbuka per status?",
        expectedTools: ["aggregate_entity", "list_entities"],
        facts: {
          entity: "work_order",
          openByStatus: OPEN_WORK_ORDERS.reduce<Record<string, number>>(
            (n, w) => ({ ...n, [w.status]: (n[w.status] ?? 0) + 1 }),
            {},
          ),
          openCount: OPEN_WORK_ORDERS.length,
          docNumbers: OPEN_WORK_ORDERS.map((w) => w.docNumber),
        },
      },
      {
        id: "generic-tax-invoices-not-sent",
        loginAs: USERS.admin.email,
        question: "Faktur pajak EVAL mana yang belum dikirim ke toko?",
        expectedTools: ["query_entity"],
        facts: {
          entity: "tax_invoice",
          status: "CREATED",
          invoiceNo: DOC.taxCreated,
          notSentCount: 1,
          alreadySent: DOC.taxSent,
        },
      },
    ],
  };
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

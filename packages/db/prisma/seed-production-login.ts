/**
 * Production-friendly minimal seeder:
 * - Creates login accounts (users)
 * - Seeds RBAC permissions/roles + links to users via roleId
 * - Seeds "default settings" required by the app (UOM + UOM conversions, DocNumberConfig)
 *
 * IMPORTANT:
 * - No items
 * - No suppliers/vendors
 * - No work orders / inventory
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, DocType, Role } from "../generated/prisma/client";
import bcrypt from "bcryptjs";

import { getDatabaseUrl } from "../src/db-connection";

const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

async function truncateAllTables() {
  // WARNING: This deletes ALL rows in the current database (all base tables).
  // It is intentionally used for "production-login minimal seeder" reset/testing.
  const tables = await prisma.$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
  `;

  // Disable FK checks so truncation works regardless of relation order.
  await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0;`);

  for (const t of tables) {
    const name = t.TABLE_NAME;
    if (!name) continue;
    // TRUNCATE cannot be parameterized as an identifier.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${name}\`;`);
  }

  await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1;`);
}

async function main() {
  console.log("Seeding production-login minimal data...");

  if (process.env.SEED_NO_TRUNCATE === "1") {
    console.log("SEED_NO_TRUNCATE=1 — skipping truncate (additive seed onto existing data).");
  } else {
    await truncateAllTables();
    console.log("Database truncated (all base tables).");
  }

  // ---------- 1. Users ----------
  const adminPassword = await bcrypt.hash("admin123", 10);
  const adminPin = await bcrypt.hash("123456", 10);

  await prisma.user.upsert({
    where: { email: "admin@elorae.com" },
    update: {},
    create: {
      email: "admin@elorae.com",
      name: "Administrator",
      passwordHash: adminPassword,
      pinHash: adminPin,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "purchaser@elorae.com" },
    update: { pinHash: adminPin },
    create: {
      email: "purchaser@elorae.com",
      name: "Purchaser",
      passwordHash: await bcrypt.hash("purchaser123", 10),
      pinHash: adminPin,
      role: Role.PURCHASER,
    },
  });

  await prisma.user.upsert({
    where: { email: "warehouse@elorae.com" },
    update: { pinHash: adminPin },
    create: {
      email: "warehouse@elorae.com",
      name: "Warehouse Staff",
      passwordHash: await bcrypt.hash("warehouse123", 10),
      pinHash: adminPin,
      role: Role.WAREHOUSE,
    },
  });

  await prisma.user.upsert({
    where: { email: "production@elorae.com" },
    update: {},
    create: {
      email: "production@elorae.com",
      name: "Production Staff",
      passwordHash: await bcrypt.hash("production123", 10),
      role: Role.PRODUCTION,
    },
  });

  // Fetch created users for roleId migration.
  const admin = await prisma.user.findUnique({ where: { email: "admin@elorae.com" }, select: { id: true } });
  const purchaser = await prisma.user.findUnique({ where: { email: "purchaser@elorae.com" }, select: { id: true } });
  const warehouse = await prisma.user.findUnique({ where: { email: "warehouse@elorae.com" }, select: { id: true } });
  const production = await prisma.user.findUnique({ where: { email: "production@elorae.com" }, select: { id: true } });

  if (!admin || !purchaser || !warehouse || !production) {
    throw new Error("Failed to load one or more seeded users.");
  }

  // ---------- RBAC: Permissions and Roles ----------
  const permissions = [
    // Dashboard
    { code: "dashboard:view", module: "dashboard", action: "view", description: "View dashboard" },

    // Suppliers
    { code: "suppliers:view", module: "suppliers", action: "view", description: "View suppliers" },
    { code: "suppliers:create", module: "suppliers", action: "create", description: "Create suppliers" },
    { code: "suppliers:edit", module: "suppliers", action: "edit", description: "Edit suppliers" },
    { code: "suppliers:delete", module: "suppliers", action: "delete", description: "Delete suppliers" },
    { code: "suppliers:approve", module: "suppliers", action: "approve", description: "Approve suppliers" },

    // Supplier Types
    { code: "supplier_types:view", module: "supplier_types", action: "view", description: "View supplier types" },
    { code: "supplier_types:create", module: "supplier_types", action: "create", description: "Create supplier types" },
    { code: "supplier_types:edit", module: "supplier_types", action: "edit", description: "Edit supplier types" },
    { code: "supplier_types:delete", module: "supplier_types", action: "delete", description: "Delete supplier types" },

    // Items
    { code: "items:view", module: "items", action: "view", description: "View items" },
    { code: "items:create", module: "items", action: "create", description: "Create items" },
    { code: "items:edit", module: "items", action: "edit", description: "Edit items" },
    { code: "items:delete", module: "items", action: "delete", description: "Delete items" },

    // Purchase Orders
    { code: "purchase_orders:view", module: "purchase_orders", action: "view", description: "View purchase orders" },
    { code: "purchase_orders:create", module: "purchase_orders", action: "create", description: "Create purchase orders" },
    { code: "purchase_orders:edit", module: "purchase_orders", action: "edit", description: "Edit purchase orders" },
    { code: "purchase_orders:approve", module: "purchase_orders", action: "approve", description: "Approve purchase orders" },

    // Supplier Payments
    { code: "supplier_payments:view", module: "supplier_payments", action: "view", description: "View supplier payments" },
    { code: "supplier_payments:create", module: "supplier_payments", action: "create", description: "Create supplier payments" },
    { code: "supplier_payments:edit", module: "supplier_payments", action: "edit", description: "Edit supplier payments" },

    // Inventory
    { code: "inventory:view", module: "inventory", action: "view", description: "View inventory" },
    { code: "inventory:manage", module: "inventory", action: "manage", description: "Manage inventory" },

    // Work Orders
    { code: "work_orders:view", module: "work_orders", action: "view", description: "View work orders" },
    { code: "work_orders:create", module: "work_orders", action: "create", description: "Create work orders" },
    { code: "work_orders:manage", module: "work_orders", action: "manage", description: "Manage work orders" },

    // Nota Register
    { code: "nota_register:view", module: "nota_register", action: "view", description: "View nota register" },

    // Vendor Returns
    { code: "vendor_returns:view", module: "vendor_returns", action: "view", description: "View vendor returns" },
    { code: "vendor_returns:create", module: "vendor_returns", action: "create", description: "Create vendor returns" },
    { code: "vendor_returns:manage", module: "vendor_returns", action: "manage", description: "Manage vendor returns" },

    // Reports
    { code: "reports_hpp:view", module: "reports", action: "hpp_view", description: "View HPP reports" },

    // Audit Trail
    { code: "audit_trail:view", module: "audit_trail", action: "view", description: "View audit trail" },

    // Settings
    { code: "settings_documents:view", module: "settings", action: "documents_view", description: "View document settings" },
    { code: "settings_documents:manage", module: "settings", action: "documents_manage", description: "Manage document settings" },
    { code: "settings_tax:view", module: "settings", action: "tax_view", description: "View tax (PPN) settings" },
    { code: "settings_tax:manage", module: "settings", action: "tax_manage", description: "Manage tax (PPN) settings" },
    { code: "settings_uom:view", module: "settings", action: "uom_view", description: "View UOM settings" },
    { code: "settings_uom:manage", module: "settings", action: "uom_manage", description: "Manage UOM settings" },
    { code: "settings_security:view", module: "settings", action: "security_view", description: "View security settings" },
    { code: "settings_security:manage", module: "settings", action: "security_manage", description: "Manage security settings" },
    { code: "settings_rbac:view", module: "settings", action: "rbac_view", description: "View RBAC settings" },
    { code: "settings_rbac:manage", module: "settings", action: "rbac_manage", description: "Manage RBAC settings" },
  ];

  const permissionMap = new Map<string, { id: string; code: string }>();
  for (const perm of permissions) {
    const created = await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
    permissionMap.set(perm.code, created);
  }
  console.log(`Permissions OK (${permissionMap.size} permissions)`);

  // Create default roles
  const adminRole = await prisma.roleDefinition.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: {
      name: "ADMIN",
      description: "System administrator with full access",
      isSystem: true,
    },
  });

  const purchaserRole = await prisma.roleDefinition.upsert({
    where: { name: "PURCHASER" },
    update: {},
    create: {
      name: "PURCHASER",
      description: "Purchasing staff - manages suppliers, POs, and payments",
      isSystem: false,
    },
  });

  const warehouseRole = await prisma.roleDefinition.upsert({
    where: { name: "WAREHOUSE" },
    update: {},
    create: {
      name: "WAREHOUSE",
      description: "Warehouse staff - manages inventory",
      isSystem: false,
    },
  });

  const productionRole = await prisma.roleDefinition.upsert({
    where: { name: "PRODUCTION" },
    update: {},
    create: {
      name: "PRODUCTION",
      description: "Production staff - manages work orders",
      isSystem: false,
    },
  });

  // Assign permissions
  const adminPermissionIds = Array.from(permissionMap.values()).map((p) => p.id);
  for (const permId of adminPermissionIds) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permId } },
      update: {},
      create: { roleId: adminRole.id, permissionId: permId },
    });
  }

  const purchaserPermissions = [
    "dashboard:view",
    "suppliers:view",
    "suppliers:create",
    "supplier_types:view",
    "supplier_types:create",
    "supplier_types:edit",
    "items:view",
    "purchase_orders:view",
    "purchase_orders:create",
    "purchase_orders:edit",
    "supplier_payments:view",
    "supplier_payments:create",
    "supplier_payments:edit",
    "vendor_returns:view",
    "vendor_returns:create",
    "vendor_returns:manage",
  ];
  for (const code of purchaserPermissions) {
    const perm = permissionMap.get(code);
    if (!perm) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: purchaserRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: purchaserRole.id, permissionId: perm.id },
    });
  }

  const warehousePermissions = ["dashboard:view", "items:view", "suppliers:view", "inventory:view", "inventory:manage"];
  for (const code of warehousePermissions) {
    const perm = permissionMap.get(code);
    if (!perm) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: warehouseRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: warehouseRole.id, permissionId: perm.id },
    });
  }

  const productionPermissions = ["dashboard:view", "items:view", "work_orders:view", "work_orders:create", "work_orders:manage", "nota_register:view"];
  for (const code of productionPermissions) {
    const perm = permissionMap.get(code);
    if (!perm) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: productionRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: productionRole.id, permissionId: perm.id },
    });
  }

  // Migrate existing users to use roleId
  await prisma.user.update({ where: { id: admin.id }, data: { roleId: adminRole.id } });
  await prisma.user.update({ where: { id: purchaser.id }, data: { roleId: purchaserRole.id } });
  await prisma.user.update({ where: { id: warehouse.id }, data: { roleId: warehouseRole.id } });
  await prisma.user.update({ where: { id: production.id }, data: { roleId: productionRole.id } });

  // ---------- Default settings ----------
  // UOM + UOMConversion
  const uomMeter = await prisma.uOM.upsert({
    where: { code: "MTR" },
    update: {},
    create: { code: "MTR", nameId: "Meter", nameEn: "Meter" },
  });
  const uomYard = await prisma.uOM.upsert({
    where: { code: "YD" },
    update: {},
    create: { code: "YD", nameId: "Yard", nameEn: "Yard" },
  });
  const uomPcs = await prisma.uOM.upsert({
    where: { code: "PCS" },
    update: {},
    create: { code: "PCS", nameId: "Pieces", nameEn: "Pieces" },
  });
  const uomKg = await prisma.uOM.upsert({
    where: { code: "KG" },
    update: {},
    create: { code: "KG", nameId: "Kilogram", nameEn: "Kilogram" },
  });
  const uomRoll = await prisma.uOM.upsert({
    where: { code: "ROLL" },
    update: {},
    create: { code: "ROLL", nameId: "Roll", nameEn: "Roll" },
  });

  await prisma.uOMConversion.upsert({
    where: { fromUomId_toUomId: { fromUomId: uomRoll.id, toUomId: uomYard.id } },
    update: { factor: 100 },
    create: { fromUomId: uomRoll.id, toUomId: uomYard.id, factor: 100, isDefault: false },
  });

  // DocNumberConfig (all DocTypes)
  const docConfigs: { docType: DocType; prefix: string; resetPeriod: string }[] = [
    { docType: "PO", prefix: "PO/", resetPeriod: "YEARLY" },
    { docType: "GRN", prefix: "GRN/", resetPeriod: "MONTHLY" },
    { docType: "WO", prefix: "WO/", resetPeriod: "YEARLY" },
    { docType: "ADJ", prefix: "ADJ/", resetPeriod: "MONTHLY" },
    { docType: "RET", prefix: "RET/", resetPeriod: "MONTHLY" },
    { docType: "ISSUE", prefix: "ISS/", resetPeriod: "MONTHLY" },
    { docType: "RECEIPT", prefix: "RCPT/", resetPeriod: "MONTHLY" },
  ];
  for (const c of docConfigs) {
    await prisma.docNumberConfig.upsert({
      where: { docType: c.docType },
      update: {},
      create: {
        docType: c.docType,
        prefix: c.prefix,
        resetPeriod: c.resetPeriod,
        padding: 4,
        lastNumber: 0,
        year,
        month,
      },
    });
  }

  console.log("Production-login minimal seeding completed.");
  console.log("Login: admin@elorae.com / admin123 (PIN: 123456)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


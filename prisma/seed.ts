/**
 * Preview-ready seed: heterogeneous sample data for all modules.
 * Uses upsert for master data; creates transactional data only when count is 0 (guard) to avoid duplicates on re-run.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  PrismaClient,
  Role,
  ItemType,
  DocType,
  POStatus,
  WOStatus,
  ReturnStatus,
  AdjustmentType,
  MoveType,
  OutputMode,
  IssueType,
  ReceiptType,
  SyncStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

import { getDatabaseUrl } from "../lib/db-connection";

const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const monthStr = String(month).padStart(2, "0");

async function main() {
  console.log("Seeding database (preview-ready)...");

  // ---------- 1. Users ----------
  const adminPassword = await bcrypt.hash("admin123", 10);
  const adminPin = await bcrypt.hash("123456", 10);
  const admin = await prisma.user.upsert({
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
  const purchaser = await prisma.user.upsert({
    where: { email: "purchaser@elorae.com" },
    update: {},
    create: {
      email: "purchaser@elorae.com",
      name: "Purchaser",
      passwordHash: await bcrypt.hash("purchaser123", 10),
      role: Role.PURCHASER,
    },
  });
  const warehouse = await prisma.user.upsert({
    where: { email: "warehouse@elorae.com" },
    update: {},
    create: {
      email: "warehouse@elorae.com",
      name: "Warehouse Staff",
      passwordHash: await bcrypt.hash("warehouse123", 10),
      role: Role.WAREHOUSE,
    },
  });
  const production = await prisma.user.upsert({
    where: { email: "production@elorae.com" },
    update: {},
    create: {
      email: "production@elorae.com",
      name: "Production Staff",
      passwordHash: await bcrypt.hash("production123", 10),
      role: Role.PRODUCTION,
    },
  });
  console.log("Users OK");

  // ---------- 2. Supplier categories ----------
  const fabricCategory = await prisma.supplierCategory.upsert({
    where: { id: "cat-fabric" },
    update: {},
    create: {
      id: "cat-fabric",
      code: "FABRIC",
      nameId: "Kain",
      nameEn: "Fabric",
      description: "Fabric and textile suppliers",
    },
  });
  const accessoriesCategory = await prisma.supplierCategory.upsert({
    where: { id: "cat-accessories" },
    update: {},
    create: {
      id: "cat-accessories",
      code: "ACCESSORIES",
      nameId: "Aksesoris",
      nameEn: "Accessories",
      description: "Buttons, zippers, and other accessories",
    },
  });
  const tailorCategory = await prisma.supplierCategory.upsert({
    where: { id: "cat-tailor" },
    update: {},
    create: {
      id: "cat-tailor",
      code: "TAILOR",
      nameId: "Penjahit",
      nameEn: "Tailor",
      description: "Production vendors and tailors",
    },
  });
  console.log("Supplier categories OK");

  // ---------- 2b. Supplier types ----------
  const typeFabric = await prisma.supplierType.upsert({
    where: { id: "st-fabric" },
    update: {},
    create: { id: "st-fabric", code: "FABRIC", name: "Fabric", sortOrder: 1 },
  });
  const typeAccessories = await prisma.supplierType.upsert({
    where: { id: "st-accessories" },
    update: {},
    create: { id: "st-accessories", code: "ACCESSORIES", name: "Accessories", sortOrder: 2 },
  });
  const typeTailor = await prisma.supplierType.upsert({
    where: { id: "st-tailor" },
    update: {},
    create: { id: "st-tailor", code: "TAILOR", name: "Tailor/Production", sortOrder: 3 },
  });
  const typeOther = await prisma.supplierType.upsert({
    where: { id: "st-other" },
    update: {},
    create: { id: "st-other", code: "OTHER", name: "Other", sortOrder: 4 },
  });
  console.log("Supplier types OK");

  // ---------- 3. UOM + UOMConversion ----------
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
    create: { code: "ROLL", nameId: "Gulung", nameEn: "Roll" },
  });
  await prisma.uOMConversion.upsert({
    where: {
      fromUomId_toUomId: { fromUomId: uomRoll.id, toUomId: uomYard.id },
    },
    update: {},
    create: {
      fromUomId: uomRoll.id,
      toUomId: uomYard.id,
      factor: 25,
      isDefault: false,
    },
  });
  console.log("UOM + conversions OK");

  // ---------- 4. DocNumberConfig (all DocTypes) ----------
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
  console.log("DocNumberConfig OK");

  // ---------- 5. Suppliers ----------
  const supplier1 = await prisma.supplier.upsert({
    where: { code: "SUP0001" },
    update: {},
    create: {
      code: "SUP0001",
      name: "PT Kain Indah",
      typeId: typeFabric.id,
      categoryId: fabricCategory.id,
      address: "Jl. Textile No. 123, Bandung",
      phone: "+62 22 1234567",
      email: "sales@kainindah.com",
      bankName: "BCA",
      bankAccountName: "PT Kain Indah",
      isActive: true,
    },
  });
  const supplier2 = await prisma.supplier.upsert({
    where: { code: "SUP0002" },
    update: {},
    create: {
      code: "SUP0002",
      name: "Aksesoris Jaya",
      typeId: typeAccessories.id,
      categoryId: accessoriesCategory.id,
      address: "Jl. Accessories No. 45, Jakarta",
      phone: "+62 21 9876543",
      email: "order@aksesorisjaya.com",
      bankName: "Mandiri",
      bankAccountName: "Aksesoris Jaya",
      isActive: true,
    },
  });
  const supplier3 = await prisma.supplier.upsert({
    where: { code: "SUP0003" },
    update: {},
    create: {
      code: "SUP0003",
      name: "Penjahit Pak Budi",
      typeId: typeTailor.id,
      categoryId: tailorCategory.id,
      address: "Jl. Produksi No. 78, Bandung",
      phone: "+62 812 34567890",
      email: "budi.tailor@email.com",
      bankName: "BRI",
      bankAccountName: "Budi Santoso",
      isActive: true,
    },
  });
  const supplier4 = await prisma.supplier.upsert({
    where: { code: "SUP0004" },
    update: {},
    create: {
      code: "SUP0004",
      name: "PT Kain Sutra",
      typeId: typeFabric.id,
      categoryId: fabricCategory.id,
      address: "Jl. Sutra 10, Solo",
      isActive: false,
    },
  });
  const supplier5 = await prisma.supplier.upsert({
    where: { code: "SUP0005" },
    update: {},
    create: {
      code: "SUP0005",
      name: "CV Lainnya",
      typeId: typeOther.id,
      isActive: true,
    },
  });
  console.log("Suppliers OK");

  // ---------- 6. Items (all types, some with variants, reorderPoint) ----------
  const fabric1 = await prisma.item.upsert({
    where: { sku: "FAB-COT-001" },
    update: {},
    create: {
      sku: "FAB-COT-001",
      nameId: "Kain Katun Premium",
      nameEn: "Premium Cotton Fabric",
      type: ItemType.FABRIC,
      uomId: uomMeter.id,
      description: "High quality cotton fabric for shirts",
      reorderPoint: 100,
    },
  });
  const fabric2 = await prisma.item.upsert({
    where: { sku: "FAB-POL-001" },
    update: {},
    create: {
      sku: "FAB-POL-001",
      nameId: "Kain Polyester",
      nameEn: "Polyester Fabric",
      type: ItemType.FABRIC,
      uomId: uomMeter.id,
      description: "Polyester fabric for uniforms",
      reorderPoint: 50,
    },
  });
  const fabric3 = await prisma.item.upsert({
    where: { sku: "FAB-DEN-001" },
    update: {},
    create: {
      sku: "FAB-DEN-001",
      nameId: "Kain Denim",
      nameEn: "Denim Fabric",
      type: ItemType.FABRIC,
      uomId: uomYard.id,
      variants: JSON.stringify([
        { Color: "Blue", Wash: "Light" },
        { Color: "Blue", Wash: "Dark" },
      ]),
    },
  });
  const fabric4 = await prisma.item.upsert({
    where: { sku: "FAB-LIN-001" },
    update: {},
    create: {
      sku: "FAB-LIN-001",
      nameId: "Kain Linen",
      nameEn: "Linen Fabric",
      type: ItemType.FABRIC,
      uomId: uomMeter.id,
    },
  });
  const acc1 = await prisma.item.upsert({
    where: { sku: "ACC-BTN-001" },
    update: {},
    create: {
      sku: "ACC-BTN-001",
      nameId: "Kancing Putih",
      nameEn: "White Button",
      type: ItemType.ACCESSORIES,
      uomId: uomPcs.id,
      description: "Standard white buttons",
    },
  });
  const acc2 = await prisma.item.upsert({
    where: { sku: "ACC-ZIP-001" },
    update: {},
    create: {
      sku: "ACC-ZIP-001",
      nameId: "Resleting Hitam",
      nameEn: "Black Zipper",
      type: ItemType.ACCESSORIES,
      uomId: uomPcs.id,
      variants: JSON.stringify([{ Size: "Short" }, { Size: "Long" }]),
    },
  });
  const acc3 = await prisma.item.upsert({
    where: { sku: "ACC-THD-001" },
    update: {},
    create: {
      sku: "ACC-THD-001",
      nameId: "Benang Jahit",
      nameEn: "Sewing Thread",
      type: ItemType.ACCESSORIES,
      uomId: uomKg.id,
    },
  });
  const fg1 = await prisma.item.upsert({
    where: { sku: "FG-SHIRT-001" },
    update: {},
    create: {
      sku: "FG-SHIRT-001",
      nameId: "Kemeja Formal",
      nameEn: "Formal Shirt",
      type: ItemType.FINISHED_GOOD,
      uomId: uomPcs.id,
      description: "Long sleeve formal shirt",
    },
  });
  const fg2 = await prisma.item.upsert({
    where: { sku: "FG-JKT-001" },
    update: {},
    create: {
      sku: "FG-JKT-001",
      nameId: "Jaket Casual",
      nameEn: "Casual Jacket",
      type: ItemType.FINISHED_GOOD,
      uomId: uomPcs.id,
    },
  });
  const fg3 = await prisma.item.upsert({
    where: { sku: "FG-POLO-001" },
    update: {},
    create: {
      sku: "FG-POLO-001",
      nameId: "Kaos Polo",
      nameEn: "Polo Shirt",
      type: ItemType.FINISHED_GOOD,
      uomId: uomPcs.id,
    },
  });
  console.log("Items OK");

  // ---------- 7. ConsumptionRule (BOM) ----------
  const bomData = [
    { finishedGoodId: fg1.id, materialId: fabric1.id, qtyRequired: 2.5, wastePercent: 5 },
    { finishedGoodId: fg1.id, materialId: acc1.id, qtyRequired: 8, wastePercent: 0 },
    { finishedGoodId: fg1.id, materialId: acc3.id, qtyRequired: 0.05, wastePercent: 0 },
    { finishedGoodId: fg2.id, materialId: fabric2.id, qtyRequired: 3, wastePercent: 8 },
    { finishedGoodId: fg2.id, materialId: acc2.id, qtyRequired: 1, wastePercent: 0 },
    { finishedGoodId: fg3.id, materialId: fabric1.id, qtyRequired: 1.2, wastePercent: 3 },
    { finishedGoodId: fg3.id, materialId: acc1.id, qtyRequired: 4, wastePercent: 0 },
  ];
  for (const b of bomData) {
    await prisma.consumptionRule.upsert({
      where: {
        finishedGoodId_materialId: {
          finishedGoodId: b.finishedGoodId,
          materialId: b.materialId,
        },
      },
      update: {},
      create: {
        finishedGoodId: b.finishedGoodId,
        materialId: b.materialId,
        qtyRequired: b.qtyRequired,
        wastePercent: b.wastePercent,
      },
    });
  }
  console.log("BOM (ConsumptionRule) OK");

  // ---------- 8. InventoryValue (for items that will have stock) ----------
  const invData = [
    { itemId: fabric1.id, qtyOnHand: 500, avgCost: 25000, totalValue: 12_500_000 },
    { itemId: fabric2.id, qtyOnHand: 300, avgCost: 18000, totalValue: 5_400_000 },
    { itemId: fabric3.id, qtyOnHand: 100, avgCost: 45000, totalValue: 4_500_000 },
    { itemId: fabric4.id, qtyOnHand: 80, avgCost: 35000, totalValue: 2_800_000 },
    { itemId: acc1.id, qtyOnHand: 5000, avgCost: 200, totalValue: 1_000_000 },
    { itemId: acc2.id, qtyOnHand: 800, avgCost: 3500, totalValue: 2_800_000 },
    { itemId: acc3.id, qtyOnHand: 50, avgCost: 80000, totalValue: 4_000_000 },
    { itemId: fg1.id, qtyOnHand: 120, avgCost: 85000, totalValue: 10_200_000 },
    { itemId: fg2.id, qtyOnHand: 45, avgCost: 120000, totalValue: 5_400_000 },
    { itemId: fg3.id, qtyOnHand: 200, avgCost: 45000, totalValue: 9_000_000 },
  ];
  for (const inv of invData) {
    await prisma.inventoryValue.upsert({
      where: { itemId: inv.itemId },
      update: {},
      create: {
        itemId: inv.itemId,
        qtyOnHand: inv.qtyOnHand,
        avgCost: inv.avgCost,
        totalValue: inv.totalValue,
      },
    });
  }
  console.log("InventoryValue OK");

  // ---------- 9. Purchase orders + POItem + POStatusHistory (only if none exist) ----------
  const poCount = await prisma.purchaseOrder.count();
  if (poCount === 0) {
    const eta1 = new Date(year, month - 1, 15);
    const eta2 = new Date(year, month, 1);

    const poDraft = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO/${year}/0001`,
        supplierId: supplier1.id,
        status: POStatus.DRAFT,
        etaDate: eta1,
        currency: "IDR",
        totalAmount: 5_000_000,
        taxAmount: 0,
        grandTotal: 5_000_000,
        createdById: purchaser.id,
      },
    });
    await prisma.pOItem.createMany({
      data: [
        { poId: poDraft.id, itemId: fabric1.id, qty: 100, price: 25000, receivedQty: 0, uomId: uomMeter.id },
        { poId: poDraft.id, itemId: fabric2.id, qty: 50, price: 18000, receivedQty: 0, uomId: uomMeter.id },
      ],
    });

    const poSubmitted = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO/${year}/0002`,
        supplierId: supplier2.id,
        status: POStatus.SUBMITTED,
        etaDate: eta2,
        currency: "IDR",
        totalAmount: 2_700_000,
        taxAmount: 0,
        grandTotal: 2_700_000,
        createdById: purchaser.id,
      },
    });
    await prisma.pOItem.createMany({
      data: [
        { poId: poSubmitted.id, itemId: acc1.id, qty: 5000, price: 200, receivedQty: 0, uomId: uomPcs.id },
        { poId: poSubmitted.id, itemId: acc2.id, qty: 500, price: 3400, receivedQty: 0, uomId: uomPcs.id },
      ],
    });
    await prisma.pOStatusHistory.create({
      data: { poId: poSubmitted.id, status: POStatus.SUBMITTED, changedById: admin.id, notes: "Submitted for approval" },
    });

    const poPartial = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO/${year}/0003`,
        supplierId: supplier1.id,
        status: POStatus.PARTIAL,
        etaDate: eta2,
        currency: "IDR",
        totalAmount: 3_750_000,
        taxAmount: 0,
        grandTotal: 3_750_000,
        createdById: purchaser.id,
      },
    });
    await prisma.pOItem.createMany({
      data: [
        { poId: poPartial.id, itemId: fabric1.id, qty: 100, price: 25000, receivedQty: 50, uomId: uomMeter.id },
        { poId: poPartial.id, itemId: fabric3.id, qty: 50, price: 45000, receivedQty: 0, uomId: uomYard.id },
      ],
    });
    await prisma.pOStatusHistory.createMany({
      data: [
        { poId: poPartial.id, status: POStatus.SUBMITTED, changedById: admin.id },
        { poId: poPartial.id, status: POStatus.PARTIAL, changedById: warehouse.id, notes: "Partial GRN received" },
      ],
    });

    const poClosed = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO/${year}/0004`,
        supplierId: supplier2.id,
        status: POStatus.CLOSED,
        etaDate: new Date(year, month - 2, 20),
        currency: "IDR",
        totalAmount: 1_000_000,
        taxAmount: 0,
        grandTotal: 1_000_000,
        createdById: purchaser.id,
      },
    });
    await prisma.pOItem.createMany({
      data: [{ poId: poClosed.id, itemId: acc1.id, qty: 5000, price: 200, receivedQty: 5000, uomId: uomPcs.id }],
    });
    await prisma.pOStatusHistory.createMany({
      data: [
        { poId: poClosed.id, status: POStatus.SUBMITTED, changedById: admin.id },
        { poId: poClosed.id, status: POStatus.CLOSED, changedById: warehouse.id, notes: "Fully received" },
      ],
    });

    const poCancelled = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO/${year}/0005`,
        supplierId: supplier3.id,
        status: POStatus.CANCELLED,
        currency: "IDR",
        totalAmount: 0,
        taxAmount: 0,
        grandTotal: 0,
        createdById: purchaser.id,
      },
    });
    await prisma.pOStatusHistory.create({
      data: { poId: poCancelled.id, status: POStatus.CANCELLED, changedById: admin.id, notes: "Cancelled by request" },
    });

    console.log("Purchase orders + POItem + POStatusHistory OK");
  }

  // ---------- 10. GRN + StockMovement (only if no GRN yet) ----------
  const grnCount = await prisma.gRN.count();
  if (grnCount === 0) {
    const pos = await prisma.purchaseOrder.findMany({ where: { status: { in: [POStatus.PARTIAL, POStatus.CLOSED] } }, take: 2 });
    const poForGrn = pos[0];
    const grn1 = await prisma.gRN.create({
      data: {
        docNumber: `GRN/${year}/${monthStr}/0001`,
        poId: poForGrn?.id ?? null,
        supplierId: poForGrn?.supplierId ?? supplier1.id,
        receivedBy: warehouse.id,
        totalAmount: 1_250_000,
        items: JSON.stringify([
          { itemId: fabric1.id, qty: 50, unitCost: 25000, totalCost: 1_250_000 },
        ]),
        syncStatus: SyncStatus.SYNCED,
      },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fabric1.id,
        type: MoveType.IN,
        refType: "GRN",
        refId: grn1.id,
        refDocNumber: grn1.docNumber,
        qty: 50,
        unitCost: 25000,
        totalCost: 1_250_000,
        balanceQty: 550,
        balanceValue: 13_750_000,
      },
    });

    const grn2 = await prisma.gRN.create({
      data: {
        docNumber: `GRN/${year}/${monthStr}/0002`,
        supplierId: supplier2.id,
        receivedBy: warehouse.id,
        totalAmount: 1_700_000,
        notes: "Standalone GRN (no PO)",
        items: JSON.stringify([
          { itemId: acc2.id, qty: 500, unitCost: 3400, totalCost: 1_700_000 },
        ]),
        syncStatus: SyncStatus.SYNCED,
      },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: acc2.id,
        type: MoveType.IN,
        refType: "GRN",
        refId: grn2.id,
        refDocNumber: grn2.docNumber,
        qty: 500,
        unitCost: 3400,
        totalCost: 1_700_000,
        balanceQty: 1300,
        balanceValue: 4_500_000,
      },
    });
    console.log("GRN + StockMovement OK");
  }

  // ---------- 11. StockAdjustment (only if none) ----------
  const adjCount = await prisma.stockAdjustment.count();
  if (adjCount === 0) {
    const adj1 = await prisma.stockAdjustment.create({
      data: {
        docNumber: `ADJ/${year}/${monthStr}/0001`,
        itemId: fabric2.id,
        type: AdjustmentType.POSITIVE,
        qtyChange: 10,
        reason: "Stock take correction",
        prevQty: 300,
        newQty: 310,
        prevAvgCost: 18000,
        newAvgCost: 18000,
        approvedById: admin.id,
        createdById: warehouse.id,
      },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fabric2.id,
        type: MoveType.ADJUSTMENT,
        refType: "ADJUSTMENT",
        refId: adj1.id,
        refDocNumber: adj1.docNumber,
        qty: 10,
        unitCost: 18000,
        totalCost: 180000,
        balanceQty: 310,
        balanceValue: 5_580_000,
      },
    });

    await prisma.stockAdjustment.create({
      data: {
        docNumber: `ADJ/${year}/${monthStr}/0002`,
        itemId: acc1.id,
        type: AdjustmentType.NEGATIVE,
        qtyChange: -100,
        reason: "Damaged / write-off",
        prevQty: 5000,
        newQty: 4900,
        prevAvgCost: 200,
        newAvgCost: 200,
        approvedById: admin.id,
        createdById: warehouse.id,
      },
    });
    console.log("StockAdjustment OK");
  }

  // ---------- 12. WorkOrder + MaterialIssue + FGReceipt (only if no WO) ----------
  const woCount = await prisma.workOrder.count();
  if (woCount === 0) {
    const consumptionPlanFg1 = [
      { itemId: fabric1.id, itemName: "Kain Katun Premium", uomId: uomMeter.id, uomCode: "MTR", qtyRequired: 2.5, wastePercent: 5, plannedQty: 250, issuedQty: 250, returnedQty: 0 },
      { itemId: acc1.id, itemName: "Kancing Putih", uomId: uomPcs.id, uomCode: "PCS", qtyRequired: 8, wastePercent: 0, plannedQty: 800, issuedQty: 800, returnedQty: 0 },
      { itemId: acc3.id, itemName: "Benang Jahit", uomId: uomKg.id, uomCode: "KG", qtyRequired: 0.05, wastePercent: 0, plannedQty: 5, issuedQty: 5, returnedQty: 0 },
    ];

    const woDraft = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0001`,
        vendorId: supplier3.id,
        finishedGoodId: fg1.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 100,
        targetDate: new Date(year, month, 15),
        status: WOStatus.DRAFT,
        consumptionPlan: JSON.stringify(consumptionPlanFg1),
        createdById: production.id,
      },
    });

    const woIssued = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0002`,
        vendorId: supplier3.id,
        finishedGoodId: fg2.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 50,
        actualQty: 0,
        targetDate: new Date(year, month, 20),
        status: WOStatus.ISSUED,
        issuedAt: new Date(year, month - 1, 28),
        consumptionPlan: JSON.stringify([
          { itemId: fabric2.id, itemName: "Kain Polyester", uomId: uomMeter.id, uomCode: "MTR", qtyRequired: 3, wastePercent: 8, plannedQty: 150, issuedQty: 0, returnedQty: 0 },
          { itemId: acc2.id, itemName: "Resleting Hitam", uomId: uomPcs.id, uomCode: "PCS", qtyRequired: 1, wastePercent: 0, plannedQty: 50, issuedQty: 0, returnedQty: 0 },
        ]),
        createdById: production.id,
      },
    });

    const woInProd = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0003`,
        vendorId: supplier3.id,
        finishedGoodId: fg1.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 80,
        actualQty: 30,
        targetDate: new Date(year, month, 10),
        status: WOStatus.IN_PRODUCTION,
        issuedAt: new Date(year, month - 1, 25),
        consumptionPlan: JSON.stringify(consumptionPlanFg1.map((p) => ({ ...p, plannedQty: 80 * (p.qtyRequired * (1 + (p.wastePercent || 0) / 100)), issuedQty: 200, returnedQty: 0 }))),
        createdById: production.id,
      },
    });

    const issue1 = await prisma.materialIssue.create({
      data: {
        docNumber: `ISS/${year}/${monthStr}/0001`,
        woId: woInProd.id,
        issueType: IssueType.FABRIC,
        isPartial: false,
        items: JSON.stringify([
          { itemId: fabric1.id, qty: 200, unitCost: 25000, totalCost: 5_000_000 },
        ]),
        totalCost: 5_000_000,
        issuedById: warehouse.id,
        syncStatus: SyncStatus.SYNCED,
      },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fabric1.id,
        type: MoveType.OUT,
        refType: "WO_ISSUE",
        refId: issue1.id,
        refDocNumber: issue1.docNumber,
        qty: -200,
        unitCost: 25000,
        totalCost: 5_000_000,
        balanceQty: 350,
        balanceValue: 8_750_000,
      },
    });

    const woPartial = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0004`,
        vendorId: supplier3.id,
        finishedGoodId: fg3.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 100,
        actualQty: 60,
        targetDate: new Date(year, month - 1, 30),
        status: WOStatus.PARTIAL,
        issuedAt: new Date(year, month - 1, 20),
        consumptionPlan: JSON.stringify([
          { itemId: fabric1.id, itemName: "Kain Katun Premium", uomId: uomMeter.id, uomCode: "MTR", qtyRequired: 1.2, wastePercent: 3, plannedQty: 120, issuedQty: 120, returnedQty: 0 },
          { itemId: acc1.id, itemName: "Kancing Putih", uomId: uomPcs.id, uomCode: "PCS", qtyRequired: 4, wastePercent: 0, plannedQty: 400, issuedQty: 400, returnedQty: 0 },
        ]),
        createdById: production.id,
      },
    });

    const woCompleted = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0005`,
        vendorId: supplier3.id,
        finishedGoodId: fg1.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 50,
        actualQty: 50,
        targetDate: new Date(year, month - 1, 15),
        status: WOStatus.COMPLETED,
        issuedAt: new Date(year, month - 1, 10),
        completedAt: new Date(year, month - 1, 14),
        consumptionPlan: JSON.stringify(consumptionPlanFg1.map((p) => ({ ...p, plannedQty: 50 * (p.qtyRequired * (1 + (p.wastePercent || 0) / 100)), issuedQty: 125, returnedQty: 0 }))),
        createdById: production.id,
      },
    });

    const woCancelled = await prisma.workOrder.create({
      data: {
        docNumber: `WO/${year}/0006`,
        vendorId: supplier3.id,
        finishedGoodId: fg2.id,
        outputMode: OutputMode.GENERIC,
        plannedQty: 20,
        targetDate: new Date(year, month - 1, 5),
        status: WOStatus.CANCELLED,
        canceledAt: new Date(year, month - 1, 3),
        canceledReason: "Customer order cancelled",
        consumptionPlan: JSON.stringify([{ itemId: fabric2.id, itemName: "Kain Polyester", uomId: uomMeter.id, uomCode: "MTR", qtyRequired: 3, wastePercent: 8, plannedQty: 60, issuedQty: 0, returnedQty: 0 }]),
        createdById: production.id,
      },
    });

    const rcpWo = await prisma.workOrder.findFirst({ where: { status: WOStatus.PARTIAL } });
    if (rcpWo) {
      await prisma.fGReceipt.create({
        data: {
          docNumber: `RCPT/${year}/${monthStr}/0001`,
          woId: rcpWo.id,
          receiptType: ReceiptType.GENERIC,
          qtyReceived: 60,
          qtyRejected: 0,
          qtyAccepted: 60,
          materialCost: 2_700_000,
          avgCostPerUnit: 45000,
          totalCostValue: 2_700_000,
          receivedById: warehouse.id,
          syncStatus: SyncStatus.SYNCED,
        },
      });
    }

    console.log("WorkOrder + MaterialIssue + FGReceipt OK");
  }

  // ---------- 13. VendorReturn (only if none) ----------
  const vrCount = await prisma.vendorReturn.count();
  if (vrCount === 0) {
    const woForRet = await prisma.workOrder.findFirst({ where: { status: WOStatus.COMPLETED } });
    const linesDraft = [
      { type: "FABRIC", itemId: fabric1.id, itemName: "Kain Katun Premium", qty: 5, reason: "Defect found", condition: "DAMAGED", costValue: 125000 },
    ];
    const linesProcessed = [
      { type: "ACCESSORIES", itemId: acc1.id, itemName: "Kancing Putih", qty: 50, reason: "Wrong size", condition: "GOOD", costValue: 10000 },
    ];
    await prisma.vendorReturn.create({
      data: {
        docNumber: `RET/${year}/${monthStr}/0001`,
        woId: null,
        vendorId: supplier1.id,
        lines: JSON.stringify(linesDraft),
        totalItems: 1,
        totalValue: 125000,
        status: ReturnStatus.DRAFT,
        createdById: warehouse.id,
      },
    });
    await prisma.vendorReturn.create({
      data: {
        docNumber: `RET/${year}/${monthStr}/0002`,
        woId: woForRet?.id ?? null,
        vendorId: supplier3.id,
        lines: JSON.stringify(linesProcessed),
        totalItems: 1,
        totalValue: 10000,
        status: ReturnStatus.PROCESSED,
        processedAt: new Date(year, month - 1, 16),
        processedBy: admin.id,
        stockImpacted: true,
        createdById: warehouse.id,
      },
    });
    console.log("VendorReturn OK");
  }

  // ---------- 14. AuditLog (only if few) ----------
  const auditCount = await prisma.auditLog.count();
  if (auditCount < 5) {
    const entities = await Promise.all([
      prisma.supplier.findFirst().then((s) => ({ type: "Supplier", id: s?.id ?? "" })),
      prisma.item.findFirst().then((i) => ({ type: "Item", id: i?.id ?? "" })),
      prisma.purchaseOrder.findFirst().then((p) => ({ type: "PurchaseOrder", id: p?.id ?? "" })),
      prisma.stockAdjustment.findFirst().then((a) => ({ type: "StockAdjustment", id: a?.id ?? "" })),
    ]);
    const actions = ["CREATE", "UPDATE", "VIEW"];
    for (let i = 0; i < 12; i++) {
      const e = entities[i % entities.length];
      if (!e.id) continue;
      await prisma.auditLog.create({
        data: {
          userId: [admin.id, purchaser.id, warehouse.id][i % 3],
          action: actions[i % 3],
          entityType: e.type,
          entityId: e.id,
          changes: i % 2 === 0 ? JSON.stringify({ field: "sample" }) : undefined,
          sensitiveDataAccessed: e.type === "Supplier" && i % 3 === 2 ? "Viewed bank account" : null,
          ipAddress: "127.0.0.1",
          createdAt: new Date(now.getTime() - (i + 1) * 3600000),
        },
      });
    }
    console.log("AuditLog OK");
  }

  // ---------- 15. Bump DocNumberConfig lastNumber (only when we created data) ----------
  if (poCount === 0) {
    await prisma.docNumberConfig.update({ where: { docType: "PO" }, data: { lastNumber: 5, year, month } });
  }
  if (grnCount === 0) {
    await prisma.docNumberConfig.update({ where: { docType: "GRN" }, data: { lastNumber: 2, year, month } });
  }
  if (woCount === 0) {
    await prisma.docNumberConfig.update({ where: { docType: "WO" }, data: { lastNumber: 6, year, month } });
    await prisma.docNumberConfig.update({ where: { docType: "ISSUE" }, data: { lastNumber: 1, year, month } });
    await prisma.docNumberConfig.update({ where: { docType: "RECEIPT" }, data: { lastNumber: 1, year, month } });
  }
  if (adjCount === 0) {
    await prisma.docNumberConfig.update({ where: { docType: "ADJ" }, data: { lastNumber: 2, year, month } });
  }
  if (vrCount === 0) {
    await prisma.docNumberConfig.update({ where: { docType: "RET" }, data: { lastNumber: 2, year, month } });
  }
  console.log("DocNumberConfig lastNumber bumped (where applicable)");

  console.log("\nSeeding completed!");
  console.log("Login: admin@elorae.com / admin123 (PIN: 123456)");
  console.log("      purchaser@elorae.com / purchaser123");
  console.log("      warehouse@elorae.com / warehouse123");
  console.log("      production@elorae.com / production123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

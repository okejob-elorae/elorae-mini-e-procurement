/**
 * Seed a few SalesOrders with dummy trackingNumber for packer pool testing.
 * Idempotent: upserts by salesorderId.
 *
 * Run: pnpm exec tsx prisma/seed-packer-tracking.ts
 * (from packages/db)
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  PrismaClient,
  SalesChannel,
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";

loadDbEnv();

const databaseUrl = (getDatabaseUrl() || process.env.DATABASE_URL || "").replace(
  /^mysql:\/\//i,
  "mariadb://",
);
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

const DEMO_ORDERS = [
  {
    id: "so-demo-packer-001",
    salesorderId: 900001,
    salesorderNo: "SO-DEMO-PACK-001",
    channelOrderNo: "CH-DEMO-001",
    trackingNumber: "585573456279274832",
    courier: "Shopee Sameday",
    customerName: "Buyer Demo Packer",
    items: [
      {
        id: "soi-demo-1",
        salesorderDetailId: 9000011,
        jubelioItemId: 1001,
        jubelioItemCode: "SKU-DEMO-1",
        productName: "Kain Demo Merah",
        qty: "2",
        unitPrice: "40000",
        lineTotal: "80000",
        weightInGram: 200,
      },
      {
        id: "soi-demo-2",
        salesorderDetailId: 9000012,
        jubelioItemId: 1002,
        jubelioItemCode: "SKU-DEMO-2",
        productName: "Aksesoris Demo",
        qty: "1",
        unitPrice: "20000",
        lineTotal: "20000",
        weightInGram: 50,
      },
    ],
  },
  {
    id: "so-demo-packer-002",
    salesorderId: 900002,
    salesorderNo: "SO-DEMO-PACK-002",
    channelOrderNo: "CH-DEMO-002",
    trackingNumber: "SPXID1234567890",
    courier: "Shopee Express",
    customerName: "Buyer Demo Dua",
    items: [
      {
        id: "soi-demo-3",
        salesorderDetailId: 9000021,
        jubelioItemId: 1003,
        jubelioItemCode: "SKU-DEMO-3",
        productName: "Kain Demo Biru",
        qty: "1",
        unitPrice: "55000",
        lineTotal: "55000",
        weightInGram: 180,
      },
    ],
  },
  {
    id: "so-demo-packer-003",
    salesorderId: 900003,
    salesorderNo: "SO-DEMO-PACK-003",
    channelOrderNo: "CH-DEMO-003",
    trackingNumber: "JT9876543210",
    courier: "J&T",
    customerName: "Buyer Demo Tiga",
    items: [
      {
        id: "soi-demo-4",
        salesorderDetailId: 9000031,
        jubelioItemId: 1004,
        jubelioItemCode: "SKU-DEMO-4",
        productName: "Paket Aksesoris",
        qty: "3",
        unitPrice: "15000",
        lineTotal: "45000",
        weightInGram: 120,
      },
    ],
  },
  {
    id: "so-demo-packer-004",
    salesorderId: 900004,
    salesorderNo: "SO-DEMO-PACK-004",
    channelOrderNo: "CH-DEMO-004",
    trackingNumber: "RESIDEMO0004",
    courier: "SiCepat",
    customerName: "Buyer Demo Empat",
    items: [
      {
        id: "soi-demo-5",
        salesorderDetailId: 9000041,
        jubelioItemId: 1005,
        jubelioItemCode: "SKU-DEMO-5",
        productName: "Kain Demo Hijau",
        qty: "2",
        unitPrice: "30000",
        lineTotal: "60000",
        weightInGram: 220,
      },
    ],
  },
  {
    id: "so-demo-packer-005",
    salesorderId: 900005,
    salesorderNo: "SO-DEMO-PACK-005",
    channelOrderNo: "CH-DEMO-005",
    trackingNumber: "TKP9988776655",
    courier: "AnterAja",
    customerName: "Buyer Demo Lima",
    items: [
      {
        id: "soi-demo-6",
        salesorderDetailId: 9000051,
        jubelioItemId: 1006,
        jubelioItemCode: "SKU-DEMO-6",
        productName: "Bundle Demo",
        qty: "1",
        unitPrice: "99000",
        lineTotal: "99000",
        weightInGram: 350,
      },
    ],
  },
  {
    id: "so-demo-packer-006",
    salesorderId: 900006,
    salesorderNo: "SO-DEMO-PACK-006",
    channelOrderNo: "CH-DEMO-006",
    trackingNumber: "11004268889737",
    courier: "Shopee Express",
    customerName: "Buyer Demo Enam",
    items: [
      {
        id: "soi-demo-7",
        salesorderDetailId: 9000061,
        jubelioItemId: 1007,
        jubelioItemCode: "SKU-DEMO-7",
        productName: "Kain Demo Ungu",
        qty: "2",
        unitPrice: "45000",
        lineTotal: "90000",
        weightInGram: 240,
      },
    ],
  },
] as const;

async function main() {
  console.log("Seeding packer demo orders with trackingNumber…");

  for (const order of DEMO_ORDERS) {
    const subTotal = order.items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
    const shippingCost = 10000;
    const grandTotal = subTotal + shippingCost;

    await prisma.salesOrder.upsert({
      where: { salesorderId: order.salesorderId },
      update: {
        trackingNumber: order.trackingNumber,
        courier: order.courier,
        isCanceled: false,
        status: SalesOrderStatus.PROCESSING,
        fulfillmentStatus: SalesOrderFulfillmentStatus.PICKED,
        customerName: order.customerName,
      },
      create: {
        id: order.id,
        salesorderId: order.salesorderId,
        salesorderNo: order.salesorderNo,
        channelOrderNo: order.channelOrderNo,
        channel: SalesChannel.SHOPEE,
        sourceName: "demo-packer",
        status: SalesOrderStatus.PROCESSING,
        isCanceled: false,
        isPaid: true,
        customerName: order.customerName,
        subTotal,
        totalDisc: 0,
        totalTax: 0,
        shippingCost,
        grandTotal,
        transactionDate: new Date(),
        trackingNumber: order.trackingNumber,
        courier: order.courier,
        fulfillmentStatus: SalesOrderFulfillmentStatus.PICKED,
      },
    });

    const salesOrder = await prisma.salesOrder.findUniqueOrThrow({
      where: { salesorderId: order.salesorderId },
      select: { id: true },
    });

    for (const item of order.items) {
      await prisma.salesOrderItem.upsert({
        where: { salesorderDetailId: item.salesorderDetailId },
        update: {
          productName: item.productName,
          qty: item.qty,
          qtyInBase: item.qty,
        },
        create: {
          id: item.id,
          salesOrderId: salesOrder.id,
          salesorderDetailId: item.salesorderDetailId,
          jubelioItemId: item.jubelioItemId,
          jubelioItemCode: item.jubelioItemCode,
          productName: item.productName,
          qty: item.qty,
          qtyInBase: item.qty,
          returnedQty: 0,
          isCanceledItem: false,
          unitPrice: item.unitPrice,
          pricePaid: item.unitPrice,
          discAmount: 0,
          taxAmount: 0,
          lineTotal: item.lineTotal,
          discMarketplace: 0,
          weightInGram: item.weightInGram,
        },
      });
    }

    console.log(`  ✓ ${order.salesorderNo} → ${order.trackingNumber}`);
  }

  const withTrack = await prisma.salesOrder.count({
    where: {
      AND: [{ trackingNumber: { not: null } }, { NOT: { trackingNumber: "" } }],
    },
  });
  console.log(`Done. Orders with trackingNumber: ${withTrack}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

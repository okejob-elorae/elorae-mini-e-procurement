-- Menyamakan skema PostgreSQL dengan skema MariaDB (schema.prisma, sumber kebenaran produksi).
-- Dibuat dengan prisma migrate diff dari basis data hasil migrasi 0–63.
-- Bagian 2: tabel, kolom, dan indeks.
-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OUTSTANDING', 'PARTIAL', 'PAID', 'WRITTEN_OFF', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'RETUR_OFFSET', 'PROGRAM_DEDUCTION', 'ADMIN_FEE', 'ROUNDING_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CollectionSubmissionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FieldSalesOrderOrigin" AS ENUM ('FIELD', 'ADMIN');

-- CreateEnum
CREATE TYPE "DeliveryShipmentMethod" AS ENUM ('EXPEDITION', 'SALESMAN_CARRY');

-- CreateEnum
CREATE TYPE "DeliveryShipmentStatus" AS ENUM ('PACKED', 'IN_TRANSIT', 'DELIVERED', 'PARTIALLY_DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FieldReturnStatus" AS ENUM ('PENDING_WAREHOUSE_RECEIVING', 'MISMATCH_PENDING_RESOLUTION', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FieldReturnResolutionType" AS ENUM ('SALESMAN_BEARS', 'INVESTIGATE', 'WRITE_OFF', 'ACCEPT_SURPLUS');

-- CreateEnum
CREATE TYPE "FieldReturnReason" AS ENUM ('DAMAGED', 'UNSOLD', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "FieldReturnTransport" AS ENUM ('SELF_CARRY', 'EXPEDITION');

-- CreateEnum
CREATE TYPE "FieldReturnOrigin" AS ENUM ('FIELD', 'ADMIN');

-- CreateEnum
CREATE TYPE "FieldReturnPriceSource" AS ENUM ('DELIVERY', 'MANUAL');

-- CreateEnum
CREATE TYPE "FieldReturnValuationStatus" AS ENUM ('PENDING', 'VALUED');

-- CreateEnum
CREATE TYPE "FieldReturnOffsetStatus" AS ENUM ('AVAILABLE', 'APPLIED');

-- CreateEnum
CREATE TYPE "KonsiTransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SellThroughMethod" AS ENUM ('SPG_POS', 'SHELF_COUNT');

-- CreateEnum
CREATE TYPE "SellThroughStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SellThroughResolution" AS ENUM ('BILL', 'SHRINKAGE', 'BILL_POS', 'REDUCE');

-- CreateEnum
CREATE TYPE "SellThroughSpgShareKind" AS ENUM ('OWN', 'LATE');

-- CreateEnum
CREATE TYPE "StoreStocktakeStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StoreStocktakeCause" AS ENUM ('SHRINKAGE', 'UNRECORDED_SALE');

-- CreateEnum
CREATE TYPE "StoreSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementDeductionType" AS ENUM ('RETUR_OFFSET', 'PROGRAM', 'ADMIN_FEE');

-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('MAIN', 'STORE', 'VAN');

-- CreateEnum
CREATE TYPE "StockLedgerType" AS ENUM ('OPENING', 'IN', 'OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ItemRequestStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItemRequestLineStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "VendorBillLineType" AS ENUM ('PO_ITEM', 'WO_STEP', 'GRN_ITEM');

-- CreateEnum
CREATE TYPE "VendorPaymentMethod" AS ENUM ('BANK', 'CASH');

-- DropIndex
DROP INDEX "ConsumptionRule_finishedGoodId_materialId_key";

-- AlterTable
ALTER TABLE "ConsumptionRule" ADD COLUMN     "colorId" TEXT,
ADD COLUMN     "size" TEXT;

-- AlterTable
ALTER TABLE "FieldSalesDelivery" ADD COLUMN     "cogsAmount" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "FieldSalesOrder" ADD COLUMN     "creditExposureAtApprove" DECIMAL(15,2),
ADD COLUMN     "creditExposureAtCreate" DECIMAL(15,2),
ADD COLUMN     "creditHoldAtCreate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditLimitAtApprove" DECIMAL(15,2),
ADD COLUMN     "creditLimitAtCreate" DECIMAL(15,2),
ADD COLUMN     "creditOverrideAt" TIMESTAMP(3),
ADD COLUMN     "creditOverrideById" TEXT,
ADD COLUMN     "creditOverrideReason" TEXT,
ADD COLUMN     "origin" "FieldSalesOrderOrigin" NOT NULL DEFAULT 'FIELD';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "pantoneTcx" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "paymentTermsDays" INTEGER;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "collectorId" TEXT,
ADD COLUMN     "originalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "outstandingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sellThroughId" TEXT,
ADD COLUMN     "status" "ReceivableStatus" NOT NULL DEFAULT 'OUTSTANDING',
ALTER COLUMN "amount" SET DEFAULT 0,
ALTER COLUMN "outstanding" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "ReconciliationResult" ADD COLUMN     "errorMessage" TEXT,
ALTER COLUMN "jubelioQty" DROP NOT NULL,
ALTER COLUMN "variance" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "fileSha256" CHAR(64),
ADD COLUMN     "resyncBatchId" TEXT,
ADD COLUMN     "resyncRematchedAt" TIMESTAMP(3),
ADD COLUMN     "resyncSeededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockReservation" ADD COLUMN     "inventoryValueId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "priceDiscountPercent" DECIMAL(5,2),
ADD COLUMN     "sellThroughMethod" "SellThroughMethod",
ALTER COLUMN "npwp" SET DATA TYPE VARCHAR(32);

-- AlterTable
ALTER TABLE "StoreTransfer" ADD COLUMN     "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "note" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "reason" SET DEFAULT '',
ALTER COLUMN "reason" SET DATA TYPE VARCHAR(1000);

-- AlterTable
ALTER TABLE "StoreTransferLine" ADD COLUMN     "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "paymentTermsDays" INTEGER;

-- AlterTable
ALTER TABLE "TaxInvoice" ADD COLUMN     "buyerNpwp" VARCHAR(32),
ADD COLUMN     "ppnAmount" DECIMAL(15,2),
ADD COLUMN     "sellThroughId" TEXT,
ADD COLUMN     "taxableAmount" DECIMAL(15,2),
ALTER COLUMN "deliveryId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DeliveryShipment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "DeliveryShipmentMethod" NOT NULL,
    "status" "DeliveryShipmentStatus" NOT NULL DEFAULT 'PACKED',
    "carrierName" TEXT,
    "resiNumber" TEXT,
    "proofPhotoUrl" TEXT,
    "proofPhotoR2Key" TEXT,
    "packedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packedById" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "deliveryId" TEXT,
    "carriedById" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "gpsDistanceMeters" INTEGER,
    "signatureUrl" TEXT,
    "signatureR2Key" TEXT,
    "signedByName" TEXT,
    "completedOfflineAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "idempotencyKey" TEXT,
    "cancelReason" TEXT,
    "weightKg" DECIMAL(10,2),
    "handoverPhotoUrl" TEXT,
    "handoverPhotoR2Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "plannedQty" INTEGER NOT NULL,
    "deliveredQty" INTEGER,
    "returnedQty" INTEGER,
    "lostQty" INTEGER,

    CONSTRAINT "DeliveryShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reference" TEXT,
    "proofUrl" TEXT,
    "proofR2Key" TEXT,
    "note" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "recordedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fieldReturnId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSubmission" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "proofUrl" TEXT,
    "proofR2Key" TEXT,
    "status" "CollectionSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldReturn" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visitId" TEXT,
    "raisedById" TEXT NOT NULL,
    "status" "FieldReturnStatus" NOT NULL DEFAULT 'PENDING_WAREHOUSE_RECEIVING',
    "origin" "FieldReturnOrigin" NOT NULL DEFAULT 'FIELD',
    "transport" "FieldReturnTransport",
    "expeditionName" TEXT,
    "resiNo" TEXT,
    "notaPhotoUrl" TEXT,
    "notaPhotoR2Key" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "totalValue" DECIMAL(15,2),
    "valuationStatus" "FieldReturnValuationStatus" NOT NULL DEFAULT 'PENDING',
    "offsetStatus" "FieldReturnOffsetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "appliedValue" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "FieldReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL,
    "reason" "FieldReturnReason" NOT NULL,
    "reasonNote" TEXT,
    "receivedQty" INTEGER,
    "sellableQty" INTEGER,
    "rejectedQty" INTEGER,
    "creditedQty" INTEGER,
    "unitPrice" DECIMAL(15,2),
    "lineValue" DECIMAL(15,2),
    "priceSource" "FieldReturnPriceSource",
    "priceDeliveryLineId" TEXT,
    "priceNote" TEXT,

    CONSTRAINT "FieldReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldReturnResolution" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "type" "FieldReturnResolutionType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount" DECIMAL(15,2),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldReturnResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStock" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KonsiTransfer" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "transferredById" TEXT NOT NULL,
    "note" TEXT,
    "shipmentId" TEXT,
    "oldOrderArrival" BOOLEAN NOT NULL DEFAULT false,
    "status" "KonsiTransferStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "adjustedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KonsiTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KonsiTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,
    "mainCountedByOpnameId" TEXT,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER,
    "unitPrice" DECIMAL(15,2),

    CONSTRAINT "KonsiTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KonsiSellThrough" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "method" "SellThroughMethod" NOT NULL,
    "status" "SellThroughStatus" NOT NULL DEFAULT 'DRAFT',
    "closingStocktakeId" TEXT NOT NULL,
    "stocktakeKey" TEXT,
    "previousId" TEXT,
    "chainKey" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "salesmanId" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "total" DECIMAL(15,2),
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "baselineReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "spgSplitSnapshotAt" TIMESTAMP(3),

    CONSTRAINT "KonsiSellThrough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KonsiSellThroughLine" (
    "id" TEXT NOT NULL,
    "sellThroughId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "openingQty" DECIMAL(10,2) NOT NULL,
    "inQty" DECIMAL(10,2) NOT NULL,
    "outQty" DECIMAL(10,2) NOT NULL,
    "posSoldQty" DECIMAL(10,2) NOT NULL,
    "gapQty" DECIMAL(10,2) NOT NULL,
    "closingQty" DECIMAL(10,2) NOT NULL,
    "countedQty" DECIMAL(10,2),
    "billedQty" DECIMAL(10,2) NOT NULL,
    "shrinkageQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "surplusQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "negativeSold" BOOLEAN NOT NULL DEFAULT false,
    "lateInQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lateOutQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "latePosSoldQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lateGapQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "hasLateMovements" BOOLEAN NOT NULL DEFAULT false,
    "suggestedResolution" "SellThroughResolution",
    "resolution" "SellThroughResolution",
    "resolutionReason" TEXT,
    "unitCost" DECIMAL(15,2) NOT NULL,
    "unitPrice" DECIMAL(15,2),
    "lineTotal" DECIMAL(15,2),

    CONSTRAINT "KonsiSellThroughLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KonsiSellThroughSpgShare" (
    "id" TEXT NOT NULL,
    "sellThroughId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "salesmanId" TEXT NOT NULL,
    "share" "SellThroughSpgShareKind" NOT NULL,
    "units" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KonsiSellThroughSpgShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStocktake" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "StoreStocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "openKey" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "isFullCount" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "countFinishedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "StoreStocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStocktakeLine" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,2) NOT NULL,
    "countedQty" DECIMAL(10,2),
    "varianceQty" DECIMAL(10,2),
    "soldInPeriodQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cause" "StoreStocktakeCause",
    "reason" TEXT,
    "qtyAtApproval" DECIMAL(10,2),
    "appliedQty" DECIMAL(10,2),
    "isAdded" BOOLEAN NOT NULL DEFAULT false,
    "countFinishedAt" TIMESTAMP(3),

    CONSTRAINT "StoreStocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreAssortmentLine" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "targetQty" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "StoreAssortmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantColor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pantoneTcx" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantColorAlias" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantColorAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingVideo" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'video/webm',
    "sizeBytes" INTEGER,
    "durationSec" DECIMAL(10,2),
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "PackingVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettlement" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "expectedAmount" DECIMAL(15,2) NOT NULL,
    "actualAmount" DECIMAL(15,2) NOT NULL,
    "varianceAmount" DECIMAL(15,2) NOT NULL,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "status" "StoreSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettlementInvoice" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "StoreSettlementInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettlementDeduction" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "type" "SettlementDeductionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "percent" DECIMAL(5,2),
    "fieldReturnId" TEXT,
    "note" TEXT,
    "proofUrl" TEXT,
    "proofR2Key" TEXT,

    CONSTRAINT "StoreSettlementDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "locationType" "StockLocationType" NOT NULL,
    "locationId" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "type" "StockLedgerType" NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(15,2),
    "balanceQty" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(15,2),
    "balanceValue" DECIMAL(15,2),
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refDocNumber" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRequest" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "status" "ItemRequestStatus" NOT NULL DEFAULT 'OPEN',
    "sourceWoId" TEXT,
    "neededBy" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(10,2) NOT NULL,
    "uomId" TEXT NOT NULL,
    "status" "ItemRequestLineStatus" NOT NULL DEFAULT 'OPEN',
    "poId" TEXT,
    "poItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "vendorInvoiceNo" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "total" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "type" "VendorBillLineType" NOT NULL,
    "poItemId" TEXT,
    "woStepId" TEXT,
    "grnId" TEXT,
    "itemId" TEXT,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "refPrice" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "VendorBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "VendorPaymentMethod" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "VendorPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceRequest" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestedById" TEXT NOT NULL,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "askCount" INTEGER NOT NULL DEFAULT 1,
    "remindedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByBillId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "idempotencyKey" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceType" VARCHAR(10) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "receivedQty" DECIMAL(12,2) NOT NULL,
    "billedQty" DECIMAL(12,2) NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "amountUnknown" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupplierInvoiceRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceWaiver" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceType" VARCHAR(10) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT,
    "qty" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "SupplierInvoiceWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryShipment_docNo_key" ON "DeliveryShipment"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryShipment_deliveryId_key" ON "DeliveryShipment"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryShipment_idempotencyKey_key" ON "DeliveryShipment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DeliveryShipment_orderId_idx" ON "DeliveryShipment"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryShipment_status_idx" ON "DeliveryShipment"("status");

-- CreateIndex
CREATE INDEX "DeliveryShipment_carriedById_idx" ON "DeliveryShipment"("carriedById");

-- CreateIndex
CREATE INDEX "DeliveryShipmentLine_shipmentId_idx" ON "DeliveryShipmentLine"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_docNo_key" ON "Payment"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_storeId_paidAt_idx" ON "Payment"("storeId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_fieldReturnId_idx" ON "Payment"("fieldReturnId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_receivableId_idx" ON "PaymentAllocation"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_receivableId_key" ON "PaymentAllocation"("paymentId", "receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSubmission_paymentId_key" ON "CollectionSubmission"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSubmission_idempotencyKey_key" ON "CollectionSubmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CollectionSubmission_status_createdAt_idx" ON "CollectionSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionSubmission_receivableId_idx" ON "CollectionSubmission"("receivableId");

-- CreateIndex
CREATE INDEX "CollectionSubmission_collectorId_status_idx" ON "CollectionSubmission"("collectorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FieldReturn_docNo_key" ON "FieldReturn"("docNo");

-- CreateIndex
CREATE INDEX "FieldReturn_storeId_idx" ON "FieldReturn"("storeId");

-- CreateIndex
CREATE INDEX "FieldReturn_status_idx" ON "FieldReturn"("status");

-- CreateIndex
CREATE INDEX "FieldReturnLine_returnId_idx" ON "FieldReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "FieldReturnLine_itemId_idx" ON "FieldReturnLine"("itemId");

-- CreateIndex
CREATE INDEX "FieldReturnResolution_lineId_idx" ON "FieldReturnResolution"("lineId");

-- CreateIndex
CREATE INDEX "StoreStock_storeId_idx" ON "StoreStock"("storeId");

-- CreateIndex
CREATE INDEX "StoreStock_itemId_idx" ON "StoreStock"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStock_storeId_itemId_variantSku_key" ON "StoreStock"("storeId", "itemId", "variantSku");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiTransfer_docNo_key" ON "KonsiTransfer"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiTransfer_shipmentId_key" ON "KonsiTransfer"("shipmentId");

-- CreateIndex
CREATE INDEX "KonsiTransfer_storeId_createdAt_idx" ON "KonsiTransfer"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "KonsiTransfer_orderId_idx" ON "KonsiTransfer"("orderId");

-- CreateIndex
CREATE INDEX "KonsiTransfer_storeId_status_idx" ON "KonsiTransfer"("storeId", "status");

-- CreateIndex
CREATE INDEX "KonsiTransferLine_transferId_idx" ON "KonsiTransferLine"("transferId");

-- CreateIndex
CREATE INDEX "KonsiTransferLine_itemId_idx" ON "KonsiTransferLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiSellThrough_docNo_key" ON "KonsiSellThrough"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiSellThrough_stocktakeKey_key" ON "KonsiSellThrough"("stocktakeKey");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiSellThrough_chainKey_key" ON "KonsiSellThrough"("chainKey");

-- CreateIndex
CREATE INDEX "KonsiSellThrough_storeId_createdAt_idx" ON "KonsiSellThrough"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "KonsiSellThrough_status_idx" ON "KonsiSellThrough"("status");

-- CreateIndex
CREATE INDEX "KonsiSellThrough_closingStocktakeId_idx" ON "KonsiSellThrough"("closingStocktakeId");

-- CreateIndex
CREATE INDEX "KonsiSellThrough_salesmanId_idx" ON "KonsiSellThrough"("salesmanId");

-- CreateIndex
CREATE INDEX "KonsiSellThroughLine_sellThroughId_idx" ON "KonsiSellThroughLine"("sellThroughId");

-- CreateIndex
CREATE INDEX "KonsiSellThroughLine_itemId_idx" ON "KonsiSellThroughLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiSellThroughLine_sellThroughId_itemId_variantSku_key" ON "KonsiSellThroughLine"("sellThroughId", "itemId", "variantSku");

-- CreateIndex
CREATE INDEX "KonsiSellThroughSpgShare_sellThroughId_idx" ON "KonsiSellThroughSpgShare"("sellThroughId");

-- CreateIndex
CREATE UNIQUE INDEX "KonsiSellThroughSpgShare_split_key" ON "KonsiSellThroughSpgShare"("sellThroughId", "itemId", "variantSku", "salesmanId", "share");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStocktake_docNo_key" ON "StoreStocktake"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStocktake_openKey_key" ON "StoreStocktake"("openKey");

-- CreateIndex
CREATE INDEX "StoreStocktake_storeId_createdAt_idx" ON "StoreStocktake"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreStocktake_status_idx" ON "StoreStocktake"("status");

-- CreateIndex
CREATE INDEX "StoreStocktakeLine_stocktakeId_idx" ON "StoreStocktakeLine"("stocktakeId");

-- CreateIndex
CREATE INDEX "StoreStocktakeLine_itemId_idx" ON "StoreStocktakeLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStocktakeLine_stocktakeId_itemId_variantSku_key" ON "StoreStocktakeLine"("stocktakeId", "itemId", "variantSku");

-- CreateIndex
CREATE INDEX "StoreAssortmentLine_storeId_idx" ON "StoreAssortmentLine"("storeId");

-- CreateIndex
CREATE INDEX "StoreAssortmentLine_itemId_idx" ON "StoreAssortmentLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreAssortmentLine_storeId_itemId_variantSku_key" ON "StoreAssortmentLine"("storeId", "itemId", "variantSku");

-- CreateIndex
CREATE UNIQUE INDEX "VariantColor_name_key" ON "VariantColor"("name");

-- CreateIndex
CREATE INDEX "VariantColor_pantoneTcx_idx" ON "VariantColor"("pantoneTcx");

-- CreateIndex
CREATE UNIQUE INDEX "VariantColorAlias_matchKey_key" ON "VariantColorAlias"("matchKey");

-- CreateIndex
CREATE INDEX "VariantColorAlias_colorId_idx" ON "VariantColorAlias"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingVideo_salesOrderId_key" ON "PackingVideo"("salesOrderId");

-- CreateIndex
CREATE INDEX "PackingVideo_recordedAt_idx" ON "PackingVideo"("recordedAt");

-- CreateIndex
CREATE INDEX "PackingVideo_recordedById_idx" ON "PackingVideo"("recordedById");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSettlement_docNo_key" ON "StoreSettlement"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSettlement_idempotencyKey_key" ON "StoreSettlement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StoreSettlement_storeId_status_idx" ON "StoreSettlement"("storeId", "status");

-- CreateIndex
CREATE INDEX "StoreSettlement_salesmanId_status_idx" ON "StoreSettlement"("salesmanId", "status");

-- CreateIndex
CREATE INDEX "StoreSettlement_status_createdAt_idx" ON "StoreSettlement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StoreSettlementInvoice_receivableId_idx" ON "StoreSettlementInvoice"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSettlementInvoice_settlementId_receivableId_key" ON "StoreSettlementInvoice"("settlementId", "receivableId");

-- CreateIndex
CREATE INDEX "StoreSettlementDeduction_settlementId_idx" ON "StoreSettlementDeduction"("settlementId");

-- CreateIndex
CREATE INDEX "StoreSettlementDeduction_fieldReturnId_type_idx" ON "StoreSettlementDeduction"("fieldReturnId", "type");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_location_item_idx" ON "StockLedgerEntry"("locationType", "locationId", "itemId", "variantSku", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_location_time_idx" ON "StockLedgerEntry"("locationType", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_itemId_createdAt_idx" ON "StockLedgerEntry"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_refType_refId_idx" ON "StockLedgerEntry"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRequest_docNumber_key" ON "ItemRequest"("docNumber");

-- CreateIndex
CREATE INDEX "ItemRequest_status_createdAt_idx" ON "ItemRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ItemRequest_sourceWoId_idx" ON "ItemRequest"("sourceWoId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRequestLine_poItemId_key" ON "ItemRequestLine"("poItemId");

-- CreateIndex
CREATE INDEX "ItemRequestLine_requestId_idx" ON "ItemRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "ItemRequestLine_status_idx" ON "ItemRequestLine"("status");

-- CreateIndex
CREATE INDEX "ItemRequestLine_itemId_idx" ON "ItemRequestLine"("itemId");

-- CreateIndex
CREATE INDEX "ItemRequestLine_poId_idx" ON "ItemRequestLine"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_docNumber_key" ON "VendorBill"("docNumber");

-- CreateIndex
CREATE INDEX "VendorBill_supplierId_vendorInvoiceNo_idx" ON "VendorBill"("supplierId", "vendorInvoiceNo");

-- CreateIndex
CREATE INDEX "VendorBill_supplierId_status_idx" ON "VendorBill"("supplierId", "status");

-- CreateIndex
CREATE INDEX "VendorBill_billDate_idx" ON "VendorBill"("billDate");

-- CreateIndex
CREATE INDEX "VendorBillLine_billId_idx" ON "VendorBillLine"("billId");

-- CreateIndex
CREATE INDEX "VendorBillLine_poItemId_idx" ON "VendorBillLine"("poItemId");

-- CreateIndex
CREATE INDEX "VendorBillLine_woStepId_idx" ON "VendorBillLine"("woStepId");

-- CreateIndex
CREATE INDEX "VendorBillLine_grnId_idx" ON "VendorBillLine"("grnId");

-- CreateIndex
CREATE INDEX "VendorBillLine_grnId_itemId_idx" ON "VendorBillLine"("grnId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPayment_docNumber_key" ON "VendorPayment"("docNumber");

-- CreateIndex
CREATE INDEX "VendorPayment_supplierId_paidAt_idx" ON "VendorPayment"("supplierId", "paidAt");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_billId_idx" ON "VendorPaymentAllocation"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPaymentAllocation_paymentId_billId_key" ON "VendorPaymentAllocation"("paymentId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceRequest_idempotencyKey_key" ON "SupplierInvoiceRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierInvoiceRequest_supplierId_cancelledAt_closedAt_idx" ON "SupplierInvoiceRequest"("supplierId", "cancelledAt", "closedAt");

-- CreateIndex
CREATE INDEX "SupplierInvoiceRequest_cancelledAt_closedAt_lastRequestedAt_idx" ON "SupplierInvoiceRequest"("cancelledAt", "closedAt", "lastRequestedAt");

-- CreateIndex
CREATE INDEX "SupplierInvoiceRequestLine_sourceType_sourceId_idx" ON "SupplierInvoiceRequestLine"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceRequestLine_requestId_sourceType_sourceId_key" ON "SupplierInvoiceRequestLine"("requestId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceWaiver_sourceType_sourceId_cancelledAt_idx" ON "SupplierInvoiceWaiver"("sourceType", "sourceId", "cancelledAt");

-- CreateIndex
CREATE INDEX "SupplierInvoiceWaiver_supplierId_cancelledAt_idx" ON "SupplierInvoiceWaiver"("supplierId", "cancelledAt");

-- CreateIndex
CREATE INDEX "ConsumptionRule_finishedGoodId_materialId_idx" ON "ConsumptionRule"("finishedGoodId", "materialId");

-- CreateIndex
CREATE INDEX "ConsumptionRule_colorId_idx" ON "ConsumptionRule"("colorId");

-- CreateIndex
CREATE INDEX "Item_pantoneTcx_idx" ON "Item"("pantoneTcx");

-- CreateIndex
CREATE INDEX "LostSale_createdAt_idx" ON "LostSale"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_sellThroughId_key" ON "Receivable"("sellThroughId");

-- CreateIndex
CREATE INDEX "Receivable_storeId_status_idx" ON "Receivable"("storeId", "status");

-- CreateIndex
CREATE INDEX "Receivable_status_dueDate_idx" ON "Receivable"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Receivable_collectorId_status_idx" ON "Receivable"("collectorId", "status");

-- CreateIndex
CREATE INDEX "Settlement_resyncRematchedAt_idx" ON "Settlement"("resyncRematchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_marketplace_fileSha256_key" ON "Settlement"("marketplace", "fileSha256");

-- CreateIndex
CREATE INDEX "StoreTransfer_fromStoreId_createdAt_idx" ON "StoreTransfer"("fromStoreId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreTransfer_toStoreId_createdAt_idx" ON "StoreTransfer"("toStoreId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreTransfer_status_idx" ON "StoreTransfer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_sellThroughId_key" ON "TaxInvoice"("sellThroughId");

-- CreateIndex
CREATE INDEX "TaxInvoice_markedById_idx" ON "TaxInvoice"("markedById");

-- CreateIndex
CREATE INDEX "TaxInvoice_notaPrintedById_idx" ON "TaxInvoice"("notaPrintedById");

-- RenameIndex
ALTER INDEX "ConsignmentCommission_cycle_spg_key" RENAME TO "ConsignmentCommission_cycleId_spgUserId_key";

-- RenameIndex
ALTER INDEX "ConsignmentCycle_period_idx" RENAME TO "ConsignmentCycle_periodYear_periodMonth_idx";

-- RenameIndex
ALTER INDEX "ConsignmentCycle_store_period_key" RENAME TO "ConsignmentCycle_storeId_periodYear_periodMonth_key";

-- RenameIndex
ALTER INDEX "ConsignmentReport_cycle_source_key" RENAME TO "ConsignmentReport_cycleId_source_key";


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FieldSalesOrderStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FieldSalesOrderType" AS ENUM ('PUTUS', 'KONSI');

-- CreateEnum
CREATE TYPE "FieldSalesDeliveryStatus" AS ENUM ('PENDING', 'PARTIAL', 'DELIVERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('PENDING', 'CREATED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "ReserveSource" AS ENUM ('JUBELIO', 'FIELD_SALES', 'FIELD_SALES_KONSI');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('PERCENT', 'FIXED', 'TIERED');

-- CreateEnum
CREATE TYPE "PromoLevel" AS ENUM ('LINE', 'ORDER');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('MAPPED', 'UNMAPPED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('NEW', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SalesOrderFulfillmentStatus" AS ENUM ('PENDING', 'PICKED', 'PACKED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "SalesHistoryStatus" AS ENUM ('COMPLETED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ABCClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "XYZClass" AS ENUM ('X', 'Y', 'Z');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PURCHASER', 'WAREHOUSE', 'PRODUCTION', 'USER');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadTimeType" AS ENUM ('FIXED', 'PER_QTY');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('FABRIC', 'ACCESSORIES', 'FINISHED_GOOD');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('ERP', 'JUBELIO_INGEST');

-- CreateEnum
CREATE TYPE "ItemTypeGroup" AS ENUM ('RAW', 'FINISHED');

-- CreateEnum
CREATE TYPE "StoreTermsType" AS ENUM ('PUTUS', 'KONSI');

-- CreateEnum
CREATE TYPE "StoreChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIAL', 'CLOSED', 'OVER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SYNCED', 'PENDING', 'ERROR');

-- CreateEnum
CREATE TYPE "MoveType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "PlanYearStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ReserveState" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "OutputMode" AS ENUM ('GENERIC', 'SKU');

-- CreateEnum
CREATE TYPE "WOStatus" AS ENUM ('DRAFT', 'ISSUED', 'IN_PRODUCTION', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('FABRIC', 'ACCESSORIES');

-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('GENERIC', 'SKU');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCESSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnLineType" AS ENUM ('FABRIC', 'ACCESSORIES', 'FG_REJECT');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OpnameScope" AS ENUM ('FINISHED_GOOD', 'FABRIC', 'ACCESSORIES');

-- CreateEnum
CREATE TYPE "OpnameStatus" AS ENUM ('CREATED', 'COUNTING', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReconTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReconRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconAction" AS ENUM ('IN_SYNC', 'AUTO_CORRECTED', 'FLAGGED', 'MANUALLY_RESOLVED');

-- CreateEnum
CREATE TYPE "ReconDirection" AS ENUM ('MATCH_JUBELIO', 'REASSERT_ELORAE');

-- CreateEnum
CREATE TYPE "PriceChangeTrigger" AS ENUM ('FG_RECEIPT', 'MARGIN_CHANGE', 'DEFAULTS_CHANGE', 'MANUAL_EDIT');

-- CreateEnum
CREATE TYPE "SalesReturnStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SalesReturnItemDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASET', 'LIABILITAS', 'EKUITAS', 'PENDAPATAN', 'HPP', 'BEBAN');

-- CreateEnum
CREATE TYPE "CashFlowSection" AS ENUM ('KAS', 'OPERASIONAL', 'INVESTASI', 'PENDANAAN');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "roleId" TEXT,
    "fcmToken" TEXT,
    "themePantoneTcx" TEXT,
    "themePrimaryHex" TEXT NOT NULL DEFAULT '#334155',
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "assignedStoreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissionsVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankAccountEnc" TEXT,
    "bankAccountName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leadTimeType" "LeadTimeType" NOT NULL DEFAULT 'FIXED',
    "days" INTEGER NOT NULL,
    "rateQty" INTEGER,
    "notes" TEXT,
    "isApproval" BOOLEAN NOT NULL DEFAULT false,
    "sopInstructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainTemplateStep" (
    "id" TEXT NOT NULL,
    "chainTemplateId" TEXT NOT NULL,
    "processTemplateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ChainTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProcess" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "processTemplateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "overrideDays" INTEGER,
    "overrideRateQty" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UOM" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UOM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UOMConversion" (
    "id" TEXT NOT NULL,
    "fromUomId" TEXT NOT NULL,
    "toUomId" TEXT NOT NULL,
    "factor" DECIMAL(10,6) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UOMConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "contactName" TEXT,
    "termsType" "StoreTermsType" NOT NULL,
    "paymentTempo" INTEGER NOT NULL DEFAULT 0,
    "marginPercent" DECIMAL(5,2),
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "checkinRadiusMeters" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreVisit" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkoutAt" TIMESTAMP(3),
    "checkinLat" DECIMAL(10,7) NOT NULL,
    "checkinLng" DECIMAL(10,7) NOT NULL,
    "checkoutLat" DECIMAL(10,7),
    "checkoutLng" DECIMAL(10,7),
    "checkinDistanceMeters" INTEGER,
    "checkinOutOfRadius" BOOLEAN NOT NULL DEFAULT false,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StoreVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitPhoto" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "caption" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreChangeRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "StoreChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "contactName" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "oldName" TEXT NOT NULL,
    "oldAddress" TEXT NOT NULL,
    "oldPhone" TEXT,
    "oldContactName" TEXT,
    "oldLat" DECIMAL(10,7),
    "oldLng" DECIMAL(10,7),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "pendingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldSalesOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "visitId" TEXT,
    "status" "FieldSalesOrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "deliveryStatus" "FieldSalesDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "orderType" "FieldSalesOrderType" NOT NULL DEFAULT 'PUTUS',
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "orderDiscountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "appliedOrderPromoId" TEXT,
    "note" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldSalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldSalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "appliedPromoId" TEXT,
    "requestedUnitPrice" DECIMAL(15,2),
    "appealReason" TEXT,
    "deliveredQty" INTEGER NOT NULL DEFAULT 0,
    "cancelledQty" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,

    CONSTRAINT "FieldSalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldSalesDelivery" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "deliveredById" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldSalesDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldSalesDeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2),
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2),

    CONSTRAINT "FieldSalesDeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "status" "TaxInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceNo" TEXT,
    "markedAt" TIMESTAMP(3),
    "markedById" TEXT,
    "reason" TEXT,
    "notaPrintedAt" TIMESTAMP(3),
    "notaPrintedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "level" "PromoLevel" NOT NULL,
    "termsType" "StoreTermsType" NOT NULL DEFAULT 'PUTUS',
    "value" DECIMAL(15,2),
    "minQty" INTEGER,
    "minOrderSubtotal" DECIMAL(15,2),
    "minOrderQty" INTEGER,
    "allStores" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoItem" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "PromoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoStore" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "PromoStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoTier" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "PromoTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "type" "ItemType" NOT NULL,
    "uomId" TEXT NOT NULL,
    "categoryId" TEXT,
    "variants" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reorderPoint" DECIMAL(10,2),
    "overReceiveThreshold" DECIMAL(10,2),
    "sellingPrice" DECIMAL(14,2),
    "targetMarginPercent" DECIMAL(5,2),
    "additionalCost" DECIMAL(15,2),
    "defaultPpnIncluded" BOOLEAN NOT NULL DEFAULT true,
    "minOrderQty" INTEGER,
    "source" "ItemSource" NOT NULL DEFAULT 'ERP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "url" VARCHAR(500) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "jubelioImageId" TEXT,
    "jubelioImageKey" VARCHAR(500),
    "jubelioImageThumbnail" VARCHAR(500),
    "syncedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'ERP_UPLOAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionRule" (
    "id" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyRequired" DECIMAL(10,4) NOT NULL,
    "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "etaDate" TIMESTAMP(3),
    "paymentDueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "createdById" TEXT NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "chainSnapshot" JSONB,
    "chainTotalDays" INTEGER,
    "chainConfirmedStepIndex" INTEGER,
    "chainConfirmedAt" TIMESTAMP(3),
    "chainConfirmedSource" TEXT,
    "actualLeadDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "ppnIncluded" BOOLEAN NOT NULL DEFAULT true,
    "receivedQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "uomId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POStatusHistory" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "status" "POStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "notes" TEXT,
    "paymentEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryValue" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qtyOnHand" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRN" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "poId" TEXT,
    "supplierId" TEXT NOT NULL,
    "grnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT,
    "items" JSONB NOT NULL,
    "requiresOwnerApproval" BOOLEAN NOT NULL DEFAULT false,
    "ownerApprovedAt" TIMESTAMP(3),
    "ownerApprovedById" TEXT,
    "ownerDeclinedAt" TIMESTAMP(3),
    "ownerDeclinedById" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "localId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GRN_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricRoll" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rollCode" TEXT NOT NULL,
    "rollRef" TEXT NOT NULL,
    "initialLength" DECIMAL(10,2) NOT NULL,
    "remainingLength" DECIMAL(10,2) NOT NULL,
    "uomId" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "MoveType" NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refDocNumber" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "variantSku" TEXT,
    "unitCost" DECIMAL(15,2),
    "totalCost" DECIMAL(15,2),
    "balanceQty" DECIMAL(10,2) NOT NULL,
    "balanceValue" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "qtyChange" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "prevQty" DECIMAL(10,2) NOT NULL,
    "newQty" DECIMAL(10,2) NOT NULL,
    "prevAvgCost" DECIMAL(15,2) NOT NULL,
    "newAvgCost" DECIMAL(15,2) NOT NULL,
    "approvedById" TEXT,
    "createdById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ERP',
    "idempotencyKey" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpname" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "scope" "OpnameScope" NOT NULL,
    "status" "OpnameStatus" NOT NULL DEFAULT 'CREATED',
    "notes" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockOpname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpnameItem" (
    "id" TEXT NOT NULL,
    "opnameId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "itemName" TEXT NOT NULL,
    "snapshotQty" DECIMAL(10,2) NOT NULL,
    "countedQty" DECIMAL(10,2),
    "variance" DECIMAL(10,2),
    "currentQtyAtApproval" DECIMAL(10,2),
    "hadDriftWarning" BOOLEAN NOT NULL DEFAULT false,
    "adjustmentId" TEXT,
    "notes" TEXT,

    CONSTRAINT "StockOpnameItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpnameRoll" (
    "id" TEXT NOT NULL,
    "opnameId" TEXT NOT NULL,
    "fabricRollId" TEXT NOT NULL,
    "rollCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "snapshotLength" DECIMAL(10,2) NOT NULL,
    "countedLength" DECIMAL(10,2),
    "variance" DECIMAL(10,2),
    "notes" TEXT,

    CONSTRAINT "StockOpnameRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "triggeredBy" "ReconTrigger" NOT NULL,
    "status" "ReconRunStatus" NOT NULL DEFAULT 'RUNNING',
    "totalScanned" INTEGER NOT NULL DEFAULT 0,
    "inSync" INTEGER NOT NULL DEFAULT 0,
    "autoCorrected" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "itemName" TEXT NOT NULL,
    "jubelioItemId" INTEGER,
    "eloraeQty" DECIMAL(10,2) NOT NULL,
    "jubelioQty" DECIMAL(10,2) NOT NULL,
    "variance" DECIMAL(10,2) NOT NULL,
    "action" "ReconAction" NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionDirection" "ReconDirection",

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "source" "ReserveSource" NOT NULL DEFAULT 'JUBELIO',
    "salesorderId" INTEGER,
    "salesorderDetailId" INTEGER,
    "fieldSalesLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(15,4) NOT NULL,
    "consumedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "state" "ReserveState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "poId" TEXT,
    "vendorId" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "consumptionMaterialId" TEXT,
    "outputMode" "OutputMode" NOT NULL DEFAULT 'GENERIC',
    "plannedQty" DECIMAL(10,2) NOT NULL,
    "expectedConsumption" DECIMAL(10,2),
    "actualQty" DECIMAL(10,2),
    "targetDate" TIMESTAMP(3),
    "status" "WOStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledReason" TEXT,
    "consumptionPlan" JSONB NOT NULL,
    "skuBreakdown" JSONB,
    "rollBreakdown" JSONB,
    "hppMarginPercent" DECIMAL(5,2),
    "hppAdditionalCost" DECIMAL(15,2),
    "notes" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "createdById" TEXT NOT NULL,
    "chainSnapshot" JSONB,
    "chainTotalDays" INTEGER,
    "chainConfirmedStepIndex" INTEGER,
    "chainConfirmedAt" TIMESTAMP(3),
    "chainConfirmedSource" TEXT,
    "actualLeadDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderStep" (
    "id" TEXT NOT NULL,
    "woId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stepName" TEXT,
    "supplierId" TEXT NOT NULL,
    "servicePrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "servicePpnIncluded" BOOLEAN NOT NULL DEFAULT false,
    "qty" DECIMAL(10,2),
    "totalCost" DECIMAL(15,2),
    "issueDocNumber" TEXT,
    "receiptDocNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "woId" TEXT NOT NULL,
    "issueType" "IssueType" NOT NULL,
    "parentIssueId" TEXT,
    "isPartial" BOOLEAN NOT NULL DEFAULT false,
    "splitSequence" INTEGER,
    "items" JSONB NOT NULL,
    "totalCost" DECIMAL(15,2) NOT NULL,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "ackAt" TIMESTAMP(3),
    "ackPhotoUrl" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "notes" TEXT,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FGReceipt" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "woId" TEXT NOT NULL,
    "receiptType" "ReceiptType" NOT NULL,
    "qtyReceived" DECIMAL(10,2) NOT NULL,
    "qtyRejected" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "qtyAccepted" DECIMAL(10,2) NOT NULL,
    "skuBreakdown" JSONB,
    "qcPassed" BOOLEAN NOT NULL DEFAULT true,
    "qcNotes" TEXT,
    "qcPhotos" TEXT,
    "materialCost" DECIMAL(15,2),
    "avgCostPerUnit" DECIMAL(15,2),
    "totalCostValue" DECIMAL(15,2),
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "FGReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectedGoodsLedger" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refDocNumber" TEXT NOT NULL,
    "woId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedGoodsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorReturn" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "woId" TEXT,
    "vendorId" TEXT NOT NULL,
    "grnId" TEXT,
    "lines" JSONB NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "totalValue" DECIMAL(15,2) NOT NULL,
    "evidenceUrls" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "stockImpacted" BOOLEAN NOT NULL DEFAULT false,
    "trackingNumber" TEXT,
    "receiptFileUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanYear" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "PlanYearStatus" NOT NULL DEFAULT 'DRAFT',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanCategory" (
    "id" TEXT NOT NULL,
    "planYearId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "targetQty" INTEGER,
    "parentSharePercent" DECIMAL(5,2),
    "itemId" TEXT,
    "itemCategoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanMonthly" (
    "id" TEXT NOT NULL,
    "planCategoryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "targetQty" INTEGER,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "PlanMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanStage" (
    "id" TEXT NOT NULL,
    "planCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetQty" INTEGER NOT NULL,
    "targetMonth" INTEGER,
    "variantSku" TEXT,
    "supplierId" TEXT,
    "fabricNotes" TEXT,
    "colorNotes" TEXT,
    "workOrderId" TEXT,
    "planCmtAllocationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanColorAllocation" (
    "id" TEXT NOT NULL,
    "planCategoryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "variantSku" TEXT NOT NULL,
    "colorLabel" TEXT,
    "allocatedQty" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PlanColorAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanCmtAllocation" (
    "id" TEXT NOT NULL,
    "planCategoryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "variantSku" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "allocatedQty" INTEGER NOT NULL,
    "workOrderId" TEXT,
    "notes" TEXT,

    CONSTRAINT "PlanCmtAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanAccessory" (
    "id" TEXT NOT NULL,
    "planCategoryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyPerPcs" DECIMAL(10,4) NOT NULL,
    "totalQtyNeeded" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PlanAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesHistory" (
    "id" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderStatus" "SalesHistoryStatus" NOT NULL,
    "variantSku" TEXT NOT NULL,
    "parentSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "netQuantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "unitPriceAfterDiscount" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "orderTotal" DECIMAL(15,2) NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "completedDate" TIMESTAMP(3),
    "province" TEXT,
    "city" TEXT,
    "productCategory" TEXT,
    "itemId" TEXT,
    "erpVariantSku" TEXT,
    "jubelioItemId" INTEGER,
    "resolutionStatus" "ResolutionStatus" NOT NULL DEFAULT 'UNMAPPED',
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesHistoryImport" (
    "id" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "fileName" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "skippedDetails" JSONB,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesHistoryImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastConfig" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "growthFactorPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lookbackMonths" INTEGER NOT NULL DEFAULT 12,
    "weightDecay" DECIMAL(3,2) NOT NULL DEFAULT 0.90,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastResult" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "itemId" TEXT,
    "parentSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "abcClass" "ABCClass" NOT NULL,
    "xyzClass" "XYZClass" NOT NULL,
    "totalHistoricalQty" INTEGER NOT NULL,
    "totalHistoricalRevenue" DECIMAL(15,2) NOT NULL,
    "avgMonthlyDemand" DECIMAL(10,2) NOT NULL,
    "coefficientOfVariation" DECIMAL(5,4) NOT NULL,
    "forecastMonth1" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth2" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth3" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth4" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth5" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth6" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth7" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth8" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth9" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth10" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth11" INTEGER NOT NULL DEFAULT 0,
    "forecastMonth12" INTEGER NOT NULL DEFAULT 0,
    "forecastAnnual" INTEGER NOT NULL DEFAULT 0,
    "seasonalIndex1" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex2" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex3" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex4" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex5" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex6" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex7" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex8" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex9" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex10" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex11" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "seasonalIndex12" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "sensitiveDataAccessed" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocNumberConfig" (
    "id" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "resetPeriod" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL DEFAULT 0,
    "month" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocNumberConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationQueue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentNumber" (
    "id" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "lastNumber" INTEGER NOT NULL,
    "format" TEXT NOT NULL,

    CONSTRAINT "DocumentNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTypeMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "group" "ItemTypeGroup" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTypeMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanStock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VanStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanLoad" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "canvasserId" TEXT NOT NULL,
    "loadedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanLoadLine" (
    "id" TEXT NOT NULL,
    "vanLoadId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "VanLoadLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanSale" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "storeId" TEXT,
    "buyerName" TEXT,
    "buyerPhone" TEXT,
    "saleLat" DECIMAL(10,7),
    "saleLng" DECIMAL(10,7),
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "amountPaid" DECIMAL(15,2) NOT NULL,
    "changeAmount" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanSaleLine" (
    "id" TEXT NOT NULL,
    "vanSaleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "productName" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "VanSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanReconcile" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "canvasserId" TEXT NOT NULL,
    "reconciledById" TEXT NOT NULL,
    "note" TEXT,
    "totalReturnedQty" DECIMAL(10,2) NOT NULL,
    "totalVarianceQty" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanReconcile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanReconcileLine" (
    "id" TEXT NOT NULL,
    "vanReconcileId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "productName" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,2) NOT NULL,
    "countedQty" DECIMAL(10,2) NOT NULL,
    "varianceQty" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "VanReconcileLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgSale" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleLat" DECIMAL(10,7),
    "saleLng" DECIMAL(10,7),
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "cashReceived" DECIMAL(15,2) NOT NULL,
    "changeGiven" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpgSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgSaleLine" (
    "id" TEXT NOT NULL,
    "spgSaleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "SpgSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PantoneColor" (
    "tcx" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "rgbR" INTEGER NOT NULL,
    "rgbG" INTEGER NOT NULL,
    "rgbB" INTEGER NOT NULL,
    "groupName" TEXT,
    "filterTags" JSONB NOT NULL,
    "labL" DOUBLE PRECISION,
    "labA" DOUBLE PRECISION,
    "labB" DOUBLE PRECISION,
    "bookSection" INTEGER,
    "bookPage" INTEGER,
    "bookColumn" INTEGER,
    "bookRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PantoneColor_pkey" PRIMARY KEY ("tcx")
);

-- CreateTable
CREATE TABLE "PantoneColorFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tcx" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PantoneColorFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioWebhookEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventId" TEXT,
    "signature" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "skipReason" TEXT,
    "deadAt" TIMESTAMP(3),
    "lastEnqueuedAt" TIMESTAMP(3),

    CONSTRAINT "JubelioWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioProductMapping" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "jubelioItemGroupId" INTEGER NOT NULL,
    "jubelioItemId" INTEGER NOT NULL,
    "jubelioItemCode" TEXT NOT NULL,
    "erpVariantSku" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jubelioLastModified" TIMESTAMP(3),

    CONSTRAINT "JubelioProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioCategoryMapping" (
    "id" TEXT NOT NULL,
    "jubelioCategoryId" INTEGER NOT NULL,
    "itemCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JubelioCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioSalesOrderState" (
    "id" TEXT NOT NULL,
    "salesorderId" INTEGER NOT NULL,
    "stockApplied" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" TEXT,
    "lastIsCanceled" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "lastWebhookEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JubelioSalesOrderState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioApiCall" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "payloadHash" TEXT,
    "statusCode" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JubelioApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioOutbox" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "skipReason" TEXT,
    "enqueuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEnqueuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),

    CONSTRAINT "JubelioOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioSalesOrderResync" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "salesorderNo" TEXT NOT NULL,
    "salesorderId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "webhookEventId" TEXT,
    "enqueuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JubelioSalesOrderResync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioPushDefaults" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "sellTaxId" INTEGER NOT NULL DEFAULT -1,
    "buyTaxId" INTEGER NOT NULL DEFAULT -1,
    "salesAcctId" INTEGER NOT NULL DEFAULT 28,
    "cogsAcctId" INTEGER NOT NULL DEFAULT 30,
    "invtAcctId" INTEGER NOT NULL DEFAULT 4,
    "purchAcctId" INTEGER,
    "uomId" INTEGER NOT NULL DEFAULT -1,
    "brandId" TEXT,
    "brandName" TEXT,
    "sellThis" BOOLEAN NOT NULL DEFAULT true,
    "buyThis" BOOLEAN NOT NULL DEFAULT true,
    "stockThis" BOOLEAN NOT NULL DEFAULT true,
    "dropshipThis" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sellUnit" TEXT NOT NULL DEFAULT 'Buah',
    "buyUnit" TEXT NOT NULL DEFAULT 'Buah',
    "packageWeight" INTEGER NOT NULL DEFAULT 1000,
    "storePriorityQtyTreshold" INTEGER NOT NULL DEFAULT 0,
    "rop" INTEGER NOT NULL DEFAULT 0,
    "useSingleImageSet" BOOLEAN NOT NULL DEFAULT false,
    "useSerialNumber" BOOLEAN NOT NULL DEFAULT false,
    "buyPrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "defaultMarginPercent" DECIMAL(5,2),
    "defaultAdditionalCost" DECIMAL(15,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "JubelioPushDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JubelioCourier" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JubelioCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "salesorderId" INTEGER NOT NULL,
    "salesorderNo" TEXT NOT NULL,
    "channelOrderNo" TEXT,
    "channel" "SalesChannel" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL,
    "channelStatus" TEXT,
    "internalStatus" TEXT,
    "wmsStatus" TEXT,
    "isCanceled" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "markedAsComplete" BOOLEAN NOT NULL DEFAULT false,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "shippingProvince" TEXT,
    "shippingCity" TEXT,
    "shippingAddress" JSONB,
    "subTotal" DECIMAL(15,2) NOT NULL,
    "totalDisc" DECIMAL(15,2) NOT NULL,
    "totalTax" DECIMAL(15,2) NOT NULL,
    "shippingCost" DECIMAL(15,2) NOT NULL,
    "grandTotal" DECIMAL(15,2) NOT NULL,
    "feeBreakdown" JSONB,
    "paymentMethod" TEXT,
    "paymentDate" TIMESTAMP(3),
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "createdDateJubelio" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "cancelDate" TIMESTAMP(3),
    "lastModifiedJubelio" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "courier" TEXT,
    "lastWebhookEventId" TEXT,
    "fulfillmentStatus" "SalesOrderFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "pickedAt" TIMESTAMP(3),
    "pickedById" TEXT,
    "packedAt" TIMESTAMP(3),
    "packedById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "shipmentJubelioId" INTEGER,
    "courierId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "salesorderDetailId" INTEGER NOT NULL,
    "jubelioItemId" INTEGER NOT NULL,
    "jubelioItemCode" TEXT NOT NULL,
    "itemId" TEXT,
    "productName" TEXT NOT NULL,
    "qty" DECIMAL(15,4) NOT NULL,
    "qtyInBase" DECIMAL(15,4) NOT NULL,
    "returnedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "isCanceledItem" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "pricePaid" DECIMAL(15,2) NOT NULL,
    "discAmount" DECIMAL(15,2) NOT NULL,
    "taxAmount" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "cogs" DECIMAL(15,2),
    "discMarketplace" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "weightInGram" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPriceChangeLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "oldSellingPrice" DECIMAL(14,2),
    "newSellingPrice" DECIMAL(14,2),
    "oldAvgCost" DECIMAL(15,2),
    "newAvgCost" DECIMAL(15,2),
    "marginPercentUsed" DECIMAL(5,2),
    "additionalCostUsed" DECIMAL(15,2),
    "triggerReason" "PriceChangeTrigger" NOT NULL,
    "fgReceiptId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "ItemPriceChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "jubelioReturnId" INTEGER NOT NULL,
    "jubelioReturnNo" TEXT,
    "salesOrderId" TEXT,
    "channel" "SalesChannel" NOT NULL,
    "channelOrderNo" TEXT,
    "status" "SalesReturnStatus" NOT NULL DEFAULT 'PENDING',
    "buyerName" TEXT,
    "totalQty" DECIMAL(10,2) NOT NULL,
    "totalValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "pushOutboxRowId" TEXT,
    "rawIngestPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnItem" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "jubelioReturnDetailId" INTEGER,
    "jubelioItemId" INTEGER,
    "salesOrderDetailId" INTEGER,
    "itemId" TEXT,
    "variantSku" TEXT,
    "externalSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "itemReason" TEXT,
    "decision" "SalesReturnItemDecision" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "stockAdjustmentId" TEXT,
    "evidenceUrls" JSONB,
    "r2Keys" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cashFlowSection" "CashFlowSection",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "totalPendapatan" DECIMAL(18,2) NOT NULL,
    "totalPengeluaran" DECIMAL(18,2) NOT NULL,
    "totalDilepas" DECIMAL(18,2) NOT NULL,
    "parsedNetTotal" DECIMAL(18,2) NOT NULL,
    "checksumOk" BOOLEAN NOT NULL,
    "checksumVariance" DECIMAL(18,2) NOT NULL,
    "summaryRaw" JSONB NOT NULL,
    "sellerFeesRaw" JSONB NOT NULL,
    "adjustmentsRaw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "netIncome" DECIMAL(18,2) NOT NULL,
    "hargaAsliProduk" DECIMAL(18,2) NOT NULL,
    "totalDiskonProduk" DECIMAL(18,2) NOT NULL,
    "biayaAdministrasi" DECIMAL(18,2) NOT NULL,
    "biayaLayanan" DECIMAL(18,2) NOT NULL,
    "biayaKomisiAms" DECIMAL(18,2) NOT NULL,
    "biayaProsesPesanan" DECIMAL(18,2) NOT NULL,
    "raw" JSONB NOT NULL,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedSalesOrderId" TEXT,
    "cogsSnapshot" DECIMAL(18,2),
    "profit" DECIMAL(18,2),

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "postedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAccountMapping" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_themePantoneTcx_idx" ON "User"("themePantoneTcx");

-- CreateIndex
CREATE INDEX "User_assignedStoreId_idx" ON "User"("assignedStoreId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_name_key" ON "RoleDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierType_code_key" ON "SupplierType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_typeId_idx" ON "Supplier"("typeId");

-- CreateIndex
CREATE INDEX "Supplier_code_idx" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE INDEX "Supplier_approvedById_idx" ON "Supplier"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessTemplate_name_key" ON "ProcessTemplate"("name");

-- CreateIndex
CREATE INDEX "ProcessTemplate_isActive_idx" ON "ProcessTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChainTemplate_name_key" ON "ChainTemplate"("name");

-- CreateIndex
CREATE INDEX "ChainTemplate_isActive_idx" ON "ChainTemplate"("isActive");

-- CreateIndex
CREATE INDEX "ChainTemplateStep_processTemplateId_idx" ON "ChainTemplateStep"("processTemplateId");

-- CreateIndex
CREATE INDEX "ChainTemplateStep_chainTemplateId_idx" ON "ChainTemplateStep"("chainTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainTemplateStep_chainTemplateId_sequence_key" ON "ChainTemplateStep"("chainTemplateId", "sequence");

-- CreateIndex
CREATE INDEX "SupplierProcess_supplierId_idx" ON "SupplierProcess"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierProcess_processTemplateId_idx" ON "SupplierProcess"("processTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProcess_supplierId_sequence_key" ON "SupplierProcess"("supplierId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "UOM_code_key" ON "UOM"("code");

-- CreateIndex
CREATE INDEX "UOMConversion_fromUomId_idx" ON "UOMConversion"("fromUomId");

-- CreateIndex
CREATE INDEX "UOMConversion_toUomId_idx" ON "UOMConversion"("toUomId");

-- CreateIndex
CREATE UNIQUE INDEX "UOMConversion_fromUomId_toUomId_key" ON "UOMConversion"("fromUomId", "toUomId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Store_isActive_name_idx" ON "Store"("isActive", "name");

-- CreateIndex
CREATE INDEX "StoreVisit_userId_checkoutAt_idx" ON "StoreVisit"("userId", "checkoutAt");

-- CreateIndex
CREATE INDEX "StoreVisit_storeId_checkinAt_idx" ON "StoreVisit"("storeId", "checkinAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitPhoto_clientId_key" ON "VisitPhoto"("clientId");

-- CreateIndex
CREATE INDEX "VisitPhoto_visitId_idx" ON "VisitPhoto"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreChangeRequest_pendingKey_key" ON "StoreChangeRequest"("pendingKey");

-- CreateIndex
CREATE INDEX "StoreChangeRequest_status_createdAt_idx" ON "StoreChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StoreChangeRequest_storeId_status_idx" ON "StoreChangeRequest"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FieldSalesOrder_orderNo_key" ON "FieldSalesOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "FieldSalesOrder_idempotencyKey_key" ON "FieldSalesOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FieldSalesOrder_status_createdAt_idx" ON "FieldSalesOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FieldSalesOrder_storeId_createdAt_idx" ON "FieldSalesOrder"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "FieldSalesOrder_salesmanId_createdAt_idx" ON "FieldSalesOrder"("salesmanId", "createdAt");

-- CreateIndex
CREATE INDEX "FieldSalesOrderLine_orderId_idx" ON "FieldSalesOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "FieldSalesOrderLine_itemId_idx" ON "FieldSalesOrderLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldSalesDelivery_docNo_key" ON "FieldSalesDelivery"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "FieldSalesDelivery_idempotencyKey_key" ON "FieldSalesDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FieldSalesDelivery_orderId_idx" ON "FieldSalesDelivery"("orderId");

-- CreateIndex
CREATE INDEX "FieldSalesDelivery_deliveredAt_idx" ON "FieldSalesDelivery"("deliveredAt");

-- CreateIndex
CREATE INDEX "FieldSalesDeliveryLine_deliveryId_idx" ON "FieldSalesDeliveryLine"("deliveryId");

-- CreateIndex
CREATE INDEX "FieldSalesDeliveryLine_orderLineId_idx" ON "FieldSalesDeliveryLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_deliveryId_key" ON "TaxInvoice"("deliveryId");

-- CreateIndex
CREATE INDEX "TaxInvoice_status_idx" ON "TaxInvoice"("status");

-- CreateIndex
CREATE INDEX "Promo_isActive_level_idx" ON "Promo"("isActive", "level");

-- CreateIndex
CREATE INDEX "PromoItem_itemId_idx" ON "PromoItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoItem_promoId_itemId_key" ON "PromoItem"("promoId", "itemId");

-- CreateIndex
CREATE INDEX "PromoStore_storeId_idx" ON "PromoStore"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoStore_promoId_storeId_key" ON "PromoStore"("promoId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoTier_promoId_minQty_key" ON "PromoTier"("promoId", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");

-- CreateIndex
CREATE INDEX "Item_type_isActive_idx" ON "Item"("type", "isActive");

-- CreateIndex
CREATE INDEX "Item_sku_idx" ON "Item"("sku");

-- CreateIndex
CREATE INDEX "Item_uomId_idx" ON "Item"("uomId");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemImage_jubelioImageId_key" ON "ItemImage"("jubelioImageId");

-- CreateIndex
CREATE INDEX "ItemImage_itemId_variantSku_sortOrder_idx" ON "ItemImage"("itemId", "variantSku", "sortOrder");

-- CreateIndex
CREATE INDEX "ItemImage_itemId_jubelioImageId_idx" ON "ItemImage"("itemId", "jubelioImageId");

-- CreateIndex
CREATE INDEX "ConsumptionRule_finishedGoodId_idx" ON "ConsumptionRule"("finishedGoodId");

-- CreateIndex
CREATE INDEX "ConsumptionRule_materialId_idx" ON "ConsumptionRule"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionRule_finishedGoodId_materialId_key" ON "ConsumptionRule"("finishedGoodId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_docNumber_key" ON "PurchaseOrder"("docNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_etaDate_idx" ON "PurchaseOrder"("etaDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_docNumber_idx" ON "PurchaseOrder"("docNumber");

-- CreateIndex
CREATE INDEX "POItem_poId_idx" ON "POItem"("poId");

-- CreateIndex
CREATE INDEX "POItem_itemId_idx" ON "POItem"("itemId");

-- CreateIndex
CREATE INDEX "POItem_poId_itemId_variantSku_idx" ON "POItem"("poId", "itemId", "variantSku");

-- CreateIndex
CREATE INDEX "POStatusHistory_poId_createdAt_idx" ON "POStatusHistory"("poId", "createdAt");

-- CreateIndex
CREATE INDEX "POStatusHistory_changedById_idx" ON "POStatusHistory"("changedById");

-- CreateIndex
CREATE INDEX "InventoryValue_itemId_idx" ON "InventoryValue"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryValue_itemId_variantSku_key" ON "InventoryValue"("itemId", "variantSku");

-- CreateIndex
CREATE UNIQUE INDEX "GRN_docNumber_key" ON "GRN"("docNumber");

-- CreateIndex
CREATE INDEX "GRN_poId_idx" ON "GRN"("poId");

-- CreateIndex
CREATE INDEX "GRN_supplierId_idx" ON "GRN"("supplierId");

-- CreateIndex
CREATE INDEX "GRN_grnDate_idx" ON "GRN"("grnDate");

-- CreateIndex
CREATE INDEX "GRN_docNumber_idx" ON "GRN"("docNumber");

-- CreateIndex
CREATE INDEX "GRN_ownerApprovedById_idx" ON "GRN"("ownerApprovedById");

-- CreateIndex
CREATE INDEX "GRN_ownerDeclinedById_idx" ON "GRN"("ownerDeclinedById");

-- CreateIndex
CREATE UNIQUE INDEX "FabricRoll_rollCode_key" ON "FabricRoll"("rollCode");

-- CreateIndex
CREATE INDEX "FabricRoll_grnId_idx" ON "FabricRoll"("grnId");

-- CreateIndex
CREATE INDEX "FabricRoll_itemId_idx" ON "FabricRoll"("itemId");

-- CreateIndex
CREATE INDEX "FabricRoll_itemId_isClosed_remainingLength_idx" ON "FabricRoll"("itemId", "isClosed", "remainingLength");

-- CreateIndex
CREATE INDEX "FabricRoll_uomId_idx" ON "FabricRoll"("uomId");

-- CreateIndex
CREATE INDEX "FabricRoll_rollCode_idx" ON "FabricRoll"("rollCode");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_docNumber_key" ON "StockAdjustment"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_idempotencyKey_key" ON "StockAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockAdjustment_itemId_idx" ON "StockAdjustment"("itemId");

-- CreateIndex
CREATE INDEX "StockAdjustment_approvedById_idx" ON "StockAdjustment"("approvedById");

-- CreateIndex
CREATE INDEX "StockAdjustment_createdById_idx" ON "StockAdjustment"("createdById");

-- CreateIndex
CREATE INDEX "StockAdjustment_docNumber_idx" ON "StockAdjustment"("docNumber");

-- CreateIndex
CREATE INDEX "StockAdjustment_source_createdAt_idx" ON "StockAdjustment"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockOpname_docNumber_key" ON "StockOpname"("docNumber");

-- CreateIndex
CREATE INDEX "StockOpname_scope_idx" ON "StockOpname"("scope");

-- CreateIndex
CREATE INDEX "StockOpname_status_idx" ON "StockOpname"("status");

-- CreateIndex
CREATE INDEX "StockOpname_docNumber_idx" ON "StockOpname"("docNumber");

-- CreateIndex
CREATE INDEX "StockOpname_createdById_idx" ON "StockOpname"("createdById");

-- CreateIndex
CREATE INDEX "StockOpnameItem_opnameId_idx" ON "StockOpnameItem"("opnameId");

-- CreateIndex
CREATE INDEX "StockOpnameItem_itemId_idx" ON "StockOpnameItem"("itemId");

-- CreateIndex
CREATE INDEX "StockOpnameRoll_opnameId_idx" ON "StockOpnameRoll"("opnameId");

-- CreateIndex
CREATE INDEX "StockOpnameRoll_fabricRollId_idx" ON "StockOpnameRoll"("fabricRollId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_idx" ON "ReconciliationRun"("status");

-- CreateIndex
CREATE INDEX "ReconciliationRun_startedAt_idx" ON "ReconciliationRun"("startedAt");

-- CreateIndex
CREATE INDEX "ReconciliationResult_runId_idx" ON "ReconciliationResult"("runId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_action_idx" ON "ReconciliationResult"("action");

-- CreateIndex
CREATE INDEX "ReconciliationResult_itemId_idx" ON "ReconciliationResult"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_salesorderDetailId_key" ON "StockReservation"("salesorderDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_fieldSalesLineId_key" ON "StockReservation"("fieldSalesLineId");

-- CreateIndex
CREATE INDEX "StockReservation_salesorderId_idx" ON "StockReservation"("salesorderId");

-- CreateIndex
CREATE INDEX "StockReservation_state_idx" ON "StockReservation"("state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_docNumber_key" ON "WorkOrder"("docNumber");

-- CreateIndex
CREATE INDEX "WorkOrder_poId_idx" ON "WorkOrder"("poId");

-- CreateIndex
CREATE INDEX "WorkOrder_vendorId_idx" ON "WorkOrder"("vendorId");

-- CreateIndex
CREATE INDEX "WorkOrder_finishedGoodId_idx" ON "WorkOrder"("finishedGoodId");

-- CreateIndex
CREATE INDEX "WorkOrder_consumptionMaterialId_idx" ON "WorkOrder"("consumptionMaterialId");

-- CreateIndex
CREATE INDEX "WorkOrder_createdById_idx" ON "WorkOrder"("createdById");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_targetDate_idx" ON "WorkOrder"("targetDate");

-- CreateIndex
CREATE INDEX "WorkOrder_docNumber_idx" ON "WorkOrder"("docNumber");

-- CreateIndex
CREATE INDEX "WorkOrderStep_woId_idx" ON "WorkOrderStep"("woId");

-- CreateIndex
CREATE INDEX "WorkOrderStep_supplierId_idx" ON "WorkOrderStep"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderStep_woId_sequence_key" ON "WorkOrderStep"("woId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIssue_docNumber_key" ON "MaterialIssue"("docNumber");

-- CreateIndex
CREATE INDEX "MaterialIssue_woId_idx" ON "MaterialIssue"("woId");

-- CreateIndex
CREATE INDEX "MaterialIssue_issuedById_idx" ON "MaterialIssue"("issuedById");

-- CreateIndex
CREATE INDEX "MaterialIssue_issuedAt_idx" ON "MaterialIssue"("issuedAt");

-- CreateIndex
CREATE INDEX "MaterialIssue_docNumber_idx" ON "MaterialIssue"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FGReceipt_docNumber_key" ON "FGReceipt"("docNumber");

-- CreateIndex
CREATE INDEX "FGReceipt_woId_idx" ON "FGReceipt"("woId");

-- CreateIndex
CREATE INDEX "FGReceipt_receivedById_idx" ON "FGReceipt"("receivedById");

-- CreateIndex
CREATE INDEX "FGReceipt_receivedAt_idx" ON "FGReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "FGReceipt_docNumber_idx" ON "FGReceipt"("docNumber");

-- CreateIndex
CREATE INDEX "RejectedGoodsLedger_itemId_idx" ON "RejectedGoodsLedger"("itemId");

-- CreateIndex
CREATE INDEX "RejectedGoodsLedger_refType_refId_idx" ON "RejectedGoodsLedger"("refType", "refId");

-- CreateIndex
CREATE INDEX "RejectedGoodsLedger_woId_idx" ON "RejectedGoodsLedger"("woId");

-- CreateIndex
CREATE INDEX "RejectedGoodsLedger_receivedAt_idx" ON "RejectedGoodsLedger"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorReturn_docNumber_key" ON "VendorReturn"("docNumber");

-- CreateIndex
CREATE INDEX "VendorReturn_woId_idx" ON "VendorReturn"("woId");

-- CreateIndex
CREATE INDEX "VendorReturn_vendorId_idx" ON "VendorReturn"("vendorId");

-- CreateIndex
CREATE INDEX "VendorReturn_grnId_idx" ON "VendorReturn"("grnId");

-- CreateIndex
CREATE INDEX "VendorReturn_status_idx" ON "VendorReturn"("status");

-- CreateIndex
CREATE INDEX "VendorReturn_createdById_idx" ON "VendorReturn"("createdById");

-- CreateIndex
CREATE INDEX "VendorReturn_completedById_idx" ON "VendorReturn"("completedById");

-- CreateIndex
CREATE UNIQUE INDEX "PlanYear_year_key" ON "PlanYear"("year");

-- CreateIndex
CREATE INDEX "PlanYear_createdById_idx" ON "PlanYear"("createdById");

-- CreateIndex
CREATE INDEX "PlanCategory_planYearId_idx" ON "PlanCategory"("planYearId");

-- CreateIndex
CREATE INDEX "PlanCategory_parentId_idx" ON "PlanCategory"("parentId");

-- CreateIndex
CREATE INDEX "PlanCategory_itemId_idx" ON "PlanCategory"("itemId");

-- CreateIndex
CREATE INDEX "PlanCategory_itemCategoryId_idx" ON "PlanCategory"("itemCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanCategory_planYearId_code_key" ON "PlanCategory"("planYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanCategory_planYearId_itemCategoryId_key" ON "PlanCategory"("planYearId", "itemCategoryId");

-- CreateIndex
CREATE INDEX "PlanMonthly_planCategoryId_idx" ON "PlanMonthly"("planCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanMonthly_planCategoryId_month_key" ON "PlanMonthly"("planCategoryId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PlanStage_planCmtAllocationId_key" ON "PlanStage"("planCmtAllocationId");

-- CreateIndex
CREATE INDEX "PlanStage_planCategoryId_idx" ON "PlanStage"("planCategoryId");

-- CreateIndex
CREATE INDEX "PlanStage_supplierId_idx" ON "PlanStage"("supplierId");

-- CreateIndex
CREATE INDEX "PlanStage_workOrderId_idx" ON "PlanStage"("workOrderId");

-- CreateIndex
CREATE INDEX "PlanColorAllocation_planCategoryId_idx" ON "PlanColorAllocation"("planCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanColorAllocation_planCategoryId_month_variantSku_key" ON "PlanColorAllocation"("planCategoryId", "month", "variantSku");

-- CreateIndex
CREATE INDEX "PlanCmtAllocation_planCategoryId_idx" ON "PlanCmtAllocation"("planCategoryId");

-- CreateIndex
CREATE INDEX "PlanCmtAllocation_supplierId_idx" ON "PlanCmtAllocation"("supplierId");

-- CreateIndex
CREATE INDEX "PlanCmtAllocation_workOrderId_idx" ON "PlanCmtAllocation"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanCmtAllocation_planCategoryId_month_variantSku_supplierI_key" ON "PlanCmtAllocation"("planCategoryId", "month", "variantSku", "supplierId");

-- CreateIndex
CREATE INDEX "PlanAccessory_planCategoryId_idx" ON "PlanAccessory"("planCategoryId");

-- CreateIndex
CREATE INDEX "PlanAccessory_itemId_idx" ON "PlanAccessory"("itemId");

-- CreateIndex
CREATE INDEX "SalesHistory_parentSku_orderDate_idx" ON "SalesHistory"("parentSku", "orderDate");

-- CreateIndex
CREATE INDEX "SalesHistory_orderDate_idx" ON "SalesHistory"("orderDate");

-- CreateIndex
CREATE INDEX "SalesHistory_channel_idx" ON "SalesHistory"("channel");

-- CreateIndex
CREATE INDEX "SalesHistory_importBatchId_idx" ON "SalesHistory"("importBatchId");

-- CreateIndex
CREATE INDEX "SalesHistory_orderStatus_idx" ON "SalesHistory"("orderStatus");

-- CreateIndex
CREATE INDEX "SalesHistory_itemId_idx" ON "SalesHistory"("itemId");

-- CreateIndex
CREATE INDEX "SalesHistory_resolutionStatus_idx" ON "SalesHistory"("resolutionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SalesHistory_channel_orderId_variantSku_key" ON "SalesHistory"("channel", "orderId", "variantSku");

-- CreateIndex
CREATE INDEX "SalesHistoryImport_uploadedById_idx" ON "SalesHistoryImport"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "SalesHistoryImport_channel_periodYear_periodMonth_key" ON "SalesHistoryImport"("channel", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastConfig_year_key" ON "ForecastConfig"("year");

-- CreateIndex
CREATE INDEX "ForecastConfig_createdById_idx" ON "ForecastConfig"("createdById");

-- CreateIndex
CREATE INDEX "ForecastResult_year_idx" ON "ForecastResult"("year");

-- CreateIndex
CREATE INDEX "ForecastResult_itemId_idx" ON "ForecastResult"("itemId");

-- CreateIndex
CREATE INDEX "ForecastResult_abcClass_xyzClass_idx" ON "ForecastResult"("abcClass", "xyzClass");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastResult_year_parentSku_key" ON "ForecastResult"("year", "parentSku");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocNumberConfig_docType_key" ON "DocNumberConfig"("docType");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "NotificationQueue_userId_sent_idx" ON "NotificationQueue"("userId", "sent");

-- CreateIndex
CREATE INDEX "NotificationQueue_createdAt_idx" ON "NotificationQueue"("createdAt");

-- CreateIndex
CREATE INDEX "PinAttempt_userId_createdAt_idx" ON "PinAttempt"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentNumber_docType_year_month_key" ON "DocumentNumber"("docType", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ItemTypeMaster_code_key" ON "ItemTypeMaster"("code");

-- CreateIndex
CREATE INDEX "VanStock_userId_idx" ON "VanStock"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VanStock_userId_itemId_variantSku_key" ON "VanStock"("userId", "itemId", "variantSku");

-- CreateIndex
CREATE UNIQUE INDEX "VanLoad_docNo_key" ON "VanLoad"("docNo");

-- CreateIndex
CREATE INDEX "VanLoad_canvasserId_createdAt_idx" ON "VanLoad"("canvasserId", "createdAt");

-- CreateIndex
CREATE INDEX "VanLoadLine_vanLoadId_idx" ON "VanLoadLine"("vanLoadId");

-- CreateIndex
CREATE UNIQUE INDEX "VanSale_docNo_key" ON "VanSale"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "VanSale_idempotencyKey_key" ON "VanSale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "VanSale_salesmanId_createdAt_idx" ON "VanSale"("salesmanId", "createdAt");

-- CreateIndex
CREATE INDEX "VanSale_storeId_idx" ON "VanSale"("storeId");

-- CreateIndex
CREATE INDEX "VanSaleLine_vanSaleId_idx" ON "VanSaleLine"("vanSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "VanReconcile_docNo_key" ON "VanReconcile"("docNo");

-- CreateIndex
CREATE INDEX "VanReconcile_canvasserId_createdAt_idx" ON "VanReconcile"("canvasserId", "createdAt");

-- CreateIndex
CREATE INDEX "VanReconcileLine_vanReconcileId_idx" ON "VanReconcileLine"("vanReconcileId");

-- CreateIndex
CREATE UNIQUE INDEX "SpgSale_docNo_key" ON "SpgSale"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "SpgSale_idempotencyKey_key" ON "SpgSale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SpgSale_salesmanId_createdAt_idx" ON "SpgSale"("salesmanId", "createdAt");

-- CreateIndex
CREATE INDEX "SpgSale_storeId_idx" ON "SpgSale"("storeId");

-- CreateIndex
CREATE INDEX "SpgSaleLine_spgSaleId_idx" ON "SpgSaleLine"("spgSaleId");

-- CreateIndex
CREATE INDEX "PantoneColor_name_idx" ON "PantoneColor"("name");

-- CreateIndex
CREATE INDEX "PantoneColor_groupName_idx" ON "PantoneColor"("groupName");

-- CreateIndex
CREATE INDEX "PantoneColor_bookSection_bookPage_idx" ON "PantoneColor"("bookSection", "bookPage");

-- CreateIndex
CREATE INDEX "PantoneColorFavorite_userId_idx" ON "PantoneColorFavorite"("userId");

-- CreateIndex
CREATE INDEX "PantoneColorFavorite_tcx_idx" ON "PantoneColorFavorite"("tcx");

-- CreateIndex
CREATE UNIQUE INDEX "PantoneColorFavorite_userId_tcx_key" ON "PantoneColorFavorite"("userId", "tcx");

-- CreateIndex
CREATE INDEX "JubelioWebhookEvent_status_receivedAt_idx" ON "JubelioWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "JubelioWebhookEvent_event_receivedAt_idx" ON "JubelioWebhookEvent"("event", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioWebhookEvent_event_payloadHash_key" ON "JubelioWebhookEvent"("event", "payloadHash");

-- CreateIndex
CREATE INDEX "AdminNotification_readAt_severity_createdAt_idx" ON "AdminNotification"("readAt", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotification_category_createdAt_idx" ON "AdminNotification"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioProductMapping_jubelioItemId_key" ON "JubelioProductMapping"("jubelioItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioProductMapping_jubelioItemCode_key" ON "JubelioProductMapping"("jubelioItemCode");

-- CreateIndex
CREATE INDEX "JubelioProductMapping_itemId_idx" ON "JubelioProductMapping"("itemId");

-- CreateIndex
CREATE INDEX "JubelioProductMapping_jubelioItemGroupId_idx" ON "JubelioProductMapping"("jubelioItemGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioCategoryMapping_jubelioCategoryId_key" ON "JubelioCategoryMapping"("jubelioCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioCategoryMapping_itemCategoryId_key" ON "JubelioCategoryMapping"("itemCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioSalesOrderState_salesorderId_key" ON "JubelioSalesOrderState"("salesorderId");

-- CreateIndex
CREATE INDEX "JubelioSalesOrderState_lastWebhookEventId_idx" ON "JubelioSalesOrderState"("lastWebhookEventId");

-- CreateIndex
CREATE INDEX "JubelioApiCall_createdAt_idx" ON "JubelioApiCall"("createdAt");

-- CreateIndex
CREATE INDEX "JubelioApiCall_path_createdAt_idx" ON "JubelioApiCall"("path", "createdAt");

-- CreateIndex
CREATE INDEX "JubelioApiCall_ok_createdAt_idx" ON "JubelioApiCall"("ok", "createdAt");

-- CreateIndex
CREATE INDEX "JubelioOutbox_status_createdAt_idx" ON "JubelioOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JubelioOutbox_entityType_entityId_idx" ON "JubelioOutbox"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "JubelioOutbox_enqueuedById_idx" ON "JubelioOutbox"("enqueuedById");

-- CreateIndex
CREATE INDEX "JubelioSalesOrderResync_batchId_idx" ON "JubelioSalesOrderResync"("batchId");

-- CreateIndex
CREATE INDEX "JubelioSalesOrderResync_status_idx" ON "JubelioSalesOrderResync"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JubelioSalesOrderResync_batchId_salesorderNo_key" ON "JubelioSalesOrderResync"("batchId", "salesorderNo");

-- CreateIndex
CREATE INDEX "JubelioCourier_name_idx" ON "JubelioCourier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_salesorderId_key" ON "SalesOrder"("salesorderId");

-- CreateIndex
CREATE INDEX "SalesOrder_channel_idx" ON "SalesOrder"("channel");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_transactionDate_idx" ON "SalesOrder"("transactionDate");

-- CreateIndex
CREATE INDEX "SalesOrder_shippingProvince_idx" ON "SalesOrder"("shippingProvince");

-- CreateIndex
CREATE INDEX "SalesOrder_shippingCity_idx" ON "SalesOrder"("shippingCity");

-- CreateIndex
CREATE INDEX "SalesOrder_fulfillmentStatus_idx" ON "SalesOrder"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "SalesOrder_channelOrderNo_idx" ON "SalesOrder"("channelOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_salesorderDetailId_key" ON "SalesOrderItem"("salesorderDetailId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_itemId_idx" ON "SalesOrderItem"("itemId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_jubelioItemCode_idx" ON "SalesOrderItem"("jubelioItemCode");

-- CreateIndex
CREATE INDEX "ItemPriceChangeLog_itemId_changedAt_idx" ON "ItemPriceChangeLog"("itemId", "changedAt");

-- CreateIndex
CREATE INDEX "ItemPriceChangeLog_fgReceiptId_idx" ON "ItemPriceChangeLog"("fgReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_jubelioReturnId_key" ON "SalesReturn"("jubelioReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_jubelioReturnNo_key" ON "SalesReturn"("jubelioReturnNo");

-- CreateIndex
CREATE INDEX "SalesReturn_status_receivedAt_idx" ON "SalesReturn"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "SalesReturn_channel_status_idx" ON "SalesReturn"("channel", "status");

-- CreateIndex
CREATE INDEX "SalesReturn_salesOrderId_idx" ON "SalesReturn"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturnItem_jubelioReturnDetailId_key" ON "SalesReturnItem"("jubelioReturnDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturnItem_stockAdjustmentId_key" ON "SalesReturnItem"("stockAdjustmentId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_salesReturnId_idx" ON "SalesReturnItem"("salesReturnId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_itemId_idx" ON "SalesReturnItem"("itemId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_decision_idx" ON "SalesReturnItem"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "ChartAccount_code_key" ON "ChartAccount"("code");

-- CreateIndex
CREATE INDEX "ChartAccount_parentId_idx" ON "ChartAccount"("parentId");

-- CreateIndex
CREATE INDEX "ChartAccount_type_isActive_idx" ON "ChartAccount"("type", "isActive");

-- CreateIndex
CREATE INDEX "ChartAccount_code_idx" ON "ChartAccount"("code");

-- CreateIndex
CREATE INDEX "Settlement_marketplace_periodFrom_idx" ON "Settlement"("marketplace", "periodFrom");

-- CreateIndex
CREATE INDEX "SettlementLine_settlementId_idx" ON "SettlementLine"("settlementId");

-- CreateIndex
CREATE INDEX "SettlementLine_orderNo_idx" ON "SettlementLine"("orderNo");

-- CreateIndex
CREATE INDEX "Journal_date_idx" ON "Journal"("date");

-- CreateIndex
CREATE INDEX "Journal_sourceType_sourceId_idx" ON "Journal"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_sourceType_sourceId_key" ON "Journal"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_journalId_idx" ON "JournalLine"("journalId");

-- CreateIndex
CREATE INDEX "JournalLine_chartAccountId_idx" ON "JournalLine"("chartAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalAccountMapping_role_key" ON "JournalAccountMapping"("role");

-- CreateIndex
CREATE INDEX "JournalAccountMapping_chartAccountId_idx" ON "JournalAccountMapping"("chartAccountId");

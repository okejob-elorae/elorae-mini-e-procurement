-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,
    `refresh_token` TEXT NULL,
    `access_token` TEXT NULL,
    `expires_at` INTEGER NULL,
    `token_type` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `id_token` TEXT NULL,
    `session_state` VARCHAR(191) NULL,

    INDEX `Account_userId_idx`(`userId`),
    UNIQUE INDEX `Account_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `sessionToken` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Session_sessionToken_key`(`sessionToken`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `pinHash` VARCHAR(191) NULL,
    `role` ENUM('ADMIN', 'PURCHASER', 'WAREHOUSE', 'PRODUCTION', 'USER') NOT NULL DEFAULT 'USER',
    `fcmToken` VARCHAR(191) NULL,
    `emailVerified` DATETIME(3) NULL,
    `image` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationToken` (
    `identifier` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VerificationToken_token_key`(`token`),
    UNIQUE INDEX `VerificationToken_identifier_token_key`(`identifier`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierCategory` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameId` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SupplierCategory_code_key`(`code`),
    INDEX `SupplierCategory_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('FABRIC', 'ACCESSORIES', 'TAILOR', 'OTHER') NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAccountEnc` VARCHAR(191) NULL,
    `bankAccountName` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Supplier_code_key`(`code`),
    INDEX `Supplier_type_idx`(`type`),
    INDEX `Supplier_categoryId_idx`(`categoryId`),
    INDEX `Supplier_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UOM` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameId` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UOM_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UOMConversion` (
    `id` VARCHAR(191) NOT NULL,
    `fromUomId` VARCHAR(191) NOT NULL,
    `toUomId` VARCHAR(191) NOT NULL,
    `factor` DECIMAL(10, 6) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,

    INDEX `UOMConversion_fromUomId_idx`(`fromUomId`),
    INDEX `UOMConversion_toUomId_idx`(`toUomId`),
    UNIQUE INDEX `UOMConversion_fromUomId_toUomId_key`(`fromUomId`, `toUomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `nameId` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `type` ENUM('FABRIC', 'ACCESSORIES', 'FINISHED_GOOD') NOT NULL,
    `uomId` VARCHAR(191) NOT NULL,
    `variants` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `reorderPoint` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Item_sku_key`(`sku`),
    INDEX `Item_type_isActive_idx`(`type`, `isActive`),
    INDEX `Item_sku_idx`(`sku`),
    INDEX `Item_uomId_idx`(`uomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumptionRule` (
    `id` VARCHAR(191) NOT NULL,
    `finishedGoodId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `qtyRequired` DECIMAL(10, 4) NOT NULL,
    `wastePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsumptionRule_finishedGoodId_idx`(`finishedGoodId`),
    INDEX `ConsumptionRule_materialId_idx`(`materialId`),
    UNIQUE INDEX `ConsumptionRule_finishedGoodId_materialId_key`(`finishedGoodId`, `materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrder` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'PARTIAL', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `etaDate` DATETIME(3) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'IDR',
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grandTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `terms` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseOrder_docNumber_key`(`docNumber`),
    INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
    INDEX `PurchaseOrder_status_idx`(`status`),
    INDEX `PurchaseOrder_etaDate_idx`(`etaDate`),
    INDEX `PurchaseOrder_docNumber_idx`(`docNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `POItem` (
    `id` VARCHAR(191) NOT NULL,
    `poId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `receivedQty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `uomId` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `POItem_poId_idx`(`poId`),
    INDEX `POItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `POStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `poId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'PARTIAL', 'CLOSED', 'CANCELLED') NOT NULL,
    `changedById` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `POStatusHistory_poId_createdAt_idx`(`poId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryValue` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qtyOnHand` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `avgCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalValue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `lastUpdated` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InventoryValue_itemId_key`(`itemId`),
    INDEX `InventoryValue_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GRN` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `poId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `grnDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `receivedBy` VARCHAR(191) NOT NULL,
    `totalAmount` DECIMAL(15, 2) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `photoUrls` VARCHAR(191) NULL,
    `items` JSON NOT NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',
    `localId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GRN_docNumber_key`(`docNumber`),
    INDEX `GRN_poId_idx`(`poId`),
    INDEX `GRN_grnDate_idx`(`grnDate`),
    INDEX `GRN_docNumber_idx`(`docNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `type` ENUM('IN', 'OUT', 'ADJUSTMENT') NOT NULL,
    `refType` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `refDocNumber` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `unitCost` DECIMAL(15, 2) NULL,
    `totalCost` DECIMAL(15, 2) NULL,
    `balanceQty` DECIMAL(10, 2) NOT NULL,
    `balanceValue` DECIMAL(15, 2) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockMovement_itemId_createdAt_idx`(`itemId`, `createdAt`),
    INDEX `StockMovement_refType_refId_idx`(`refType`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `type` ENUM('POSITIVE', 'NEGATIVE') NOT NULL,
    `qtyChange` DECIMAL(10, 2) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `evidenceUrl` VARCHAR(191) NULL,
    `prevQty` DECIMAL(10, 2) NOT NULL,
    `newQty` DECIMAL(10, 2) NOT NULL,
    `prevAvgCost` DECIMAL(15, 2) NOT NULL,
    `newAvgCost` DECIMAL(15, 2) NOT NULL,
    `approvedById` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockAdjustment_docNumber_key`(`docNumber`),
    INDEX `StockAdjustment_itemId_idx`(`itemId`),
    INDEX `StockAdjustment_docNumber_idx`(`docNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkOrder` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `outputMode` ENUM('GENERIC', 'SKU') NOT NULL DEFAULT 'GENERIC',
    `plannedQty` DECIMAL(10, 2) NOT NULL,
    `actualQty` DECIMAL(10, 2) NULL,
    `targetDate` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'IN_PRODUCTION', 'PARTIAL', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `issuedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `canceledAt` DATETIME(3) NULL,
    `canceledReason` VARCHAR(191) NULL,
    `consumptionPlan` JSON NOT NULL,
    `skuBreakdown` JSON NULL,
    `notes` VARCHAR(191) NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WorkOrder_docNumber_key`(`docNumber`),
    INDEX `WorkOrder_vendorId_idx`(`vendorId`),
    INDEX `WorkOrder_status_idx`(`status`),
    INDEX `WorkOrder_targetDate_idx`(`targetDate`),
    INDEX `WorkOrder_docNumber_idx`(`docNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialIssue` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `woId` VARCHAR(191) NOT NULL,
    `issueType` ENUM('FABRIC', 'ACCESSORIES') NOT NULL,
    `parentIssueId` VARCHAR(191) NULL,
    `isPartial` BOOLEAN NOT NULL DEFAULT false,
    `items` JSON NOT NULL,
    `totalCost` DECIMAL(15, 2) NOT NULL,
    `issuedById` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `ackAt` DATETIME(3) NULL,
    `ackPhotoUrl` VARCHAR(191) NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',

    UNIQUE INDEX `MaterialIssue_docNumber_key`(`docNumber`),
    INDEX `MaterialIssue_woId_idx`(`woId`),
    INDEX `MaterialIssue_issuedAt_idx`(`issuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FGReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `woId` VARCHAR(191) NOT NULL,
    `receiptType` ENUM('GENERIC', 'SKU') NOT NULL,
    `qtyReceived` DECIMAL(10, 2) NOT NULL,
    `qtyRejected` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `qtyAccepted` DECIMAL(10, 2) NOT NULL,
    `skuBreakdown` JSON NULL,
    `qcNotes` VARCHAR(191) NULL,
    `qcPhotos` VARCHAR(191) NULL,
    `receivedById` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `avgCostPerUnit` DECIMAL(15, 2) NULL,
    `totalCostValue` DECIMAL(15, 2) NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',

    UNIQUE INDEX `FGReceipt_docNumber_key`(`docNumber`),
    INDEX `FGReceipt_woId_idx`(`woId`),
    INDEX `FGReceipt_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VendorReturn` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `woId` VARCHAR(191) NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `lines` JSON NOT NULL,
    `totalItems` INTEGER NOT NULL,
    `evidenceUrls` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'PROCESSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `processedAt` DATETIME(3) NULL,
    `processedBy` VARCHAR(191) NULL,
    `stockImpacted` BOOLEAN NOT NULL DEFAULT false,
    `syncStatus` ENUM('SYNCED', 'PENDING', 'ERROR') NOT NULL DEFAULT 'SYNCED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VendorReturn_docNumber_key`(`docNumber`),
    INDEX `VendorReturn_woId_idx`(`woId`),
    INDEX `VendorReturn_vendorId_idx`(`vendorId`),
    INDEX `VendorReturn_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `changes` JSON NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_userId_idx`(`userId`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_action_idx`(`action`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentNumber` (
    `id` VARCHAR(191) NOT NULL,
    `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT') NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NULL,
    `lastNumber` INTEGER NOT NULL,
    `format` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `DocumentNumber_docType_year_month_key`(`docType`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

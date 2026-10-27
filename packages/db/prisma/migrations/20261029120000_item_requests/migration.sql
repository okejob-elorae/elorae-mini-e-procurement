-- Request Item: material requests raised from a work order's BOM shortage (or by hand) and
-- converted line by line into purchase orders.

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ') NOT NULL;

-- CreateTable
CREATE TABLE `ItemRequest` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `sourceWoId` VARCHAR(191) NULL,
    `neededBy` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ItemRequest_docNumber_key`(`docNumber`),
    INDEX `ItemRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ItemRequest_sourceWoId_idx`(`sourceWoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemRequestLine` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `qty` DECIMAL(10, 2) NOT NULL,
    `uomId` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `poId` VARCHAR(191) NULL,
    `poItemId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ItemRequestLine_poItemId_key`(`poItemId`),
    INDEX `ItemRequestLine_requestId_idx`(`requestId`),
    INDEX `ItemRequestLine_status_idx`(`status`),
    INDEX `ItemRequestLine_itemId_idx`(`itemId`),
    INDEX `ItemRequestLine_poId_idx`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Real foreign keys, which `relationMode = "prisma"` would otherwise leave out (see
-- 20261021100000_field_sales_foreign_keys). ON DELETE matches the Prisma relations: CASCADE for a
-- request's own lines, SET NULL for the PO item link (`updatePO` replaces PO items), RESTRICT for
-- the rest. No app path deletes a WorkOrder, User, UOM or PurchaseOrder; `deleteItem` counts
-- `ItemRequestLine`. Both tables are created empty above, so no orphan preflight is needed.

-- AddForeignKey
ALTER TABLE `ItemRequest`
  ADD CONSTRAINT `ItemRequest_sourceWoId_fkey` FOREIGN KEY IF NOT EXISTS (`sourceWoId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ItemRequest_createdById_fkey` FOREIGN KEY IF NOT EXISTS (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemRequestLine`
  ADD CONSTRAINT `ItemRequestLine_requestId_fkey` FOREIGN KEY IF NOT EXISTS (`requestId`) REFERENCES `ItemRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ItemRequestLine_itemId_fkey` FOREIGN KEY IF NOT EXISTS (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ItemRequestLine_uomId_fkey` FOREIGN KEY IF NOT EXISTS (`uomId`) REFERENCES `UOM`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ItemRequestLine_poId_fkey` FOREIGN KEY IF NOT EXISTS (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ItemRequestLine_poItemId_fkey` FOREIGN KEY IF NOT EXISTS (`poItemId`) REFERENCES `POItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

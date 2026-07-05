-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `orderType` ENUM('PUTUS', 'KONSI') NOT NULL DEFAULT 'PUTUS';

-- AlterTable
ALTER TABLE `StockReservation` MODIFY `source` ENUM('JUBELIO', 'FIELD_SALES', 'FIELD_SALES_KONSI') NOT NULL DEFAULT 'JUBELIO';

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI') NOT NULL;


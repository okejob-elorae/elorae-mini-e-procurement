-- Field returns take their own DocType. `RET` is NOT free: apps/web/app/actions/vendor-returns.ts
-- calls generateDocNumber('RET', tx), so sharing it would interleave two registers on one
-- counter and let a Settings prefix edit renumber vendor returns.
--
-- Re-runnable: MODIFY restates the whole ENUM, and CREATE INDEX IF NOT EXISTS is a no-op when
-- the index already exists — so re-running after
-- `prisma migrate resolve --rolled-back 20260814130000_add_field_return_doctype` is safe.

-- AlterEnum (DocType += FIELDRET)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET') NOT NULL;

-- CreateIndex: deleteItem() counts FieldReturnLine rows per item, which full-scans without this.
CREATE INDEX IF NOT EXISTS `FieldReturnLine_itemId_idx` ON `FieldReturnLine`(`itemId`);

-- CreateIndex
CREATE INDEX `FGReceipt_receivedById_idx` ON `FGReceipt`(`receivedById`);

-- CreateIndex
CREATE INDEX `GRN_supplierId_idx` ON `GRN`(`supplierId`);

-- CreateIndex
CREATE INDEX `MaterialIssue_issuedById_idx` ON `MaterialIssue`(`issuedById`);

-- CreateIndex
CREATE INDEX `POStatusHistory_changedById_idx` ON `POStatusHistory`(`changedById`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_createdById_idx` ON `PurchaseOrder`(`createdById`);

-- CreateIndex
CREATE INDEX `StockAdjustment_approvedById_idx` ON `StockAdjustment`(`approvedById`);

-- CreateIndex
CREATE INDEX `StockAdjustment_createdById_idx` ON `StockAdjustment`(`createdById`);

-- CreateIndex
CREATE INDEX `WorkOrder_createdById_idx` ON `WorkOrder`(`createdById`);

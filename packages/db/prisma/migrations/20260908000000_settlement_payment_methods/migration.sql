-- Widen the shared PaymentMethod enum on BOTH tables that use it.
-- Payment.method and CollectionSubmission.method are separate MySQL ENUM columns
-- over the same Prisma enum; widening only one truncates the other on write.
ALTER TABLE `Payment` MODIFY `method` ENUM('CASH','TRANSFER','RETUR_OFFSET','PROGRAM_DEDUCTION','ADMIN_FEE') NOT NULL;
ALTER TABLE `CollectionSubmission` MODIFY `method` ENUM('CASH','TRANSFER','RETUR_OFFSET','PROGRAM_DEDUCTION','ADMIN_FEE') NOT NULL;

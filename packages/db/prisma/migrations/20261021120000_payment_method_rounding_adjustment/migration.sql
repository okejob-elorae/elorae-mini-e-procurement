-- Widen the shared PaymentMethod enum with ROUNDING_ADJUSTMENT on BOTH tables that use it.
-- Payment.method and CollectionSubmission.method are separate MySQL ENUM columns over the
-- same Prisma enum; widening only one truncates the other on write. CollectionSubmission
-- never legitimately carries the new member (submitCollection refuses anything but CASH and
-- TRANSFER), but the column must still accept every value the Prisma enum can produce.
ALTER TABLE `Payment` MODIFY `method` ENUM('CASH','TRANSFER','RETUR_OFFSET','PROGRAM_DEDUCTION','ADMIN_FEE','ROUNDING_ADJUSTMENT') NOT NULL;
ALTER TABLE `CollectionSubmission` MODIFY `method` ENUM('CASH','TRANSFER','RETUR_OFFSET','PROGRAM_DEDUCTION','ADMIN_FEE','ROUNDING_ADJUSTMENT') NOT NULL;

-- Re-runnable: CREATE INDEX IF NOT EXISTS is a no-op when the index already exists.
CREATE INDEX IF NOT EXISTS `TaxInvoice_markedById_idx` ON `TaxInvoice`(`markedById`);
CREATE INDEX IF NOT EXISTS `TaxInvoice_notaPrintedById_idx` ON `TaxInvoice`(`notaPrintedById`);

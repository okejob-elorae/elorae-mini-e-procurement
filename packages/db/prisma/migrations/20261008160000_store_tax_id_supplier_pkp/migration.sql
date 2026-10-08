-- Identitas pajak pembeli untuk ekspor faktur keluaran Coretax (NPWP 16 digit + NITKU 22 digit)
-- dan status PKP pemasok (null = belum diisi) untuk PPN jasa jahit/pembelian.
ALTER TABLE `Store` ADD COLUMN `npwp` VARCHAR(191) NULL;
ALTER TABLE `Store` ADD COLUMN `nitku` VARCHAR(191) NULL;
ALTER TABLE `Supplier` ADD COLUMN `isPkp` BOOLEAN NULL;

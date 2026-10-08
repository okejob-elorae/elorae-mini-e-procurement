-- Identitas pajak pembeli untuk ekspor faktur keluaran Coretax (NPWP 16 digit + NITKU 22 digit)
-- dan status PKP pemasok (null = belum diisi) untuk PPN jasa jahit/pembelian.
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "npwp" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "nitku" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "isPkp" BOOLEAN;

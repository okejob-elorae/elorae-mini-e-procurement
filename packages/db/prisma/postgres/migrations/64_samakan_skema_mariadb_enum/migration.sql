-- Menyamakan skema PostgreSQL dengan skema MariaDB (schema.prisma, sumber kebenaran produksi).
-- Dibuat dengan prisma migrate diff dari basis data hasil migrasi 0–63.
-- Bagian 1: nilai enum baru (PostgreSQL tidak boleh memakai nilai enum baru di transaksi yang sama).
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocType" ADD VALUE 'FIELDRET';
ALTER TYPE "DocType" ADD VALUE 'KONSITRF';
ALTER TYPE "DocType" ADD VALUE 'STOCKTAKE';
ALTER TYPE "DocType" ADD VALUE 'PAYMENT';
ALTER TYPE "DocType" ADD VALUE 'BKM';
ALTER TYPE "DocType" ADD VALUE 'STORETRF';
ALTER TYPE "DocType" ADD VALUE 'SELLTHRU';
ALTER TYPE "DocType" ADD VALUE 'ITEMREQ';
ALTER TYPE "DocType" ADD VALUE 'VENDOR_BILL';
ALTER TYPE "DocType" ADD VALUE 'VENDOR_PAYMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoreTransferStatus" ADD VALUE 'PENDING';
ALTER TYPE "StoreTransferStatus" ADD VALUE 'APPROVED';
ALTER TYPE "StoreTransferStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaxInvoiceStatus" ADD VALUE 'SENT_TO_STORE';
ALTER TYPE "TaxInvoiceStatus" ADD VALUE 'CANCELLED';

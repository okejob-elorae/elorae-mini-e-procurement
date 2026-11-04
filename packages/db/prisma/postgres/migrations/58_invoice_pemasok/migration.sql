-- Penerimaan tanpa PO menunggu konfirmasi admin, dan selisih harga invoice pemasok menunggu keputusan
-- (keputusan pemilik 2026-11-02: P27, P49, P50, P51/P51a, P53). Kembaran migrasi MariaDB
-- 20261102190000_supplier_invoice_receipts untuk bagian yang dibaca penulis GRN dan penulis
-- pembayaran pemasok, yang juga berjalan di PostgreSQL.
--
-- GRN.requiresNoPoConfirmation: GRN yang disimpan TANPA PO tersimpan, tetapi tidak menggerakkan stok
-- dan tidak menjadi utang sampai admin mengonfirmasinya (`goods_receipts:confirm_no_po`). Bawaan false
-- ADALAH isian ulang: setiap GRN lama tetap diproses, dan GRN tanpa PO yang dicatat image lama di
-- jendela penerapan mendarat false dan diproses cara lama. noPoConfirmedAt/noPoConfirmedById
-- mencatat konfirmasinya. Penolakan BELUM dibangun putaran ini (menunggu pemilik), jadi tanpa kolom
-- penolakan.
--
-- SupplierPayableCorrection: harga invoice yang berbeda dari utang tercatat penerimaannya, lebih tinggi
-- maupun lebih rendah — satu baris MENUNGGU; seluruh penerimaan itu belum bisa dibayar sampai diputuskan.
-- Penulis pembayaran membacanya pada setiap pembayaran. Tabel tagihan vendor (VendorBill) belum ada di
-- PostgreSQL, jadi baris koreksi hanya lahir di MariaDB; di sini tabelnya kosong dan pemeriksaannya
-- tidak menemukan apa pun.
--
-- Tanpa FOREIGN KEY (relationMode = "prisma"). Menambah saja, aman dijalankan ulang.

ALTER TABLE "GRN" ADD COLUMN IF NOT EXISTS "requiresNoPoConfirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GRN" ADD COLUMN IF NOT EXISTS "noPoConfirmedAt" TIMESTAMP(3);
ALTER TABLE "GRN" ADD COLUMN IF NOT EXISTS "noPoConfirmedById" TEXT;

CREATE INDEX IF NOT EXISTS "GRN_requiresNoPoConfirmation_noPoConfirmedAt_idx" ON "GRN"("requiresNoPoConfirmation", "noPoConfirmedAt");

CREATE TABLE IF NOT EXISTS "SupplierPayableCorrection" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "billLineId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceType" VARCHAR(10) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "recordedPrice" DECIMAL(15,2) NOT NULL,
    "invoicePrice" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "dppAmount" DECIMAL(15,2) NOT NULL,
    "ppnInputAmount" DECIMAL(15,2) NOT NULL,
    "inventoryAmount" DECIMAL(15,2) NOT NULL,
    "stockAmount" DECIMAL(15,2),
    "soldAmount" DECIMAL(15,2),
    "breakdown" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayableCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPayableCorrection_billLineId_key" ON "SupplierPayableCorrection"("billLineId");
CREATE INDEX IF NOT EXISTS "SupplierPayableCorrection_sourceType_sourceId_status_idx" ON "SupplierPayableCorrection"("sourceType", "sourceId", "status");
CREATE INDEX IF NOT EXISTS "SupplierPayableCorrection_status_createdAt_idx" ON "SupplierPayableCorrection"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupplierPayableCorrection_billId_idx" ON "SupplierPayableCorrection"("billId");
